import { v4 as uuidv4 } from 'uuid';

import { getStartingBalanceCategory } from '#server/accounts/payees';
import {
  makeSplitTransaction,
  normalizeImportedPayeeName,
} from '#server/accounts/sync';
import * as db from '#server/db';
import { shoveSortOrders, TRANSACTION_SORT_INCREMENT } from '#server/db/sort';
import { runRules } from '#server/transactions/transaction-rules';
import type { TransactionForRules } from '#server/transactions/transaction-rules';
import { buildReview, validateTransferPair } from '#shared/bank-file-setup';
import type {
  Review,
  ReviewAccount,
  SetupAccountDraft,
  SetupRow,
  TransferPair,
} from '#shared/bank-file-setup';
import type { TransactionEntity } from '#types/models';

export type SetupCreateInput = {
  accounts: SetupAccountDraft[];
  confirmedPairs: TransferPair[];
  today: string;
};

export type PlannedPayee = {
  id: string;
  name: string;
  transfer_acct?: string;
};

export type CreatePlan = {
  accounts: Array<Record<string, unknown>>;
  payees: PlannedPayee[];
  transactions: Array<Record<string, unknown>>;
  accountIdByDraftId: Record<string, string>;
  transactionCount: number;
};

export class SetupValidationError extends Error {}

type PlannedAccount = {
  id: string;
  name: string;
  offbudget: 0 | 1;
  closed: 0;
  sort_order: number;
  account_group_id: null;
};

type PlannedTransaction = Omit<
  TransactionEntity,
  'category' | 'notes' | 'imported_id' | 'imported_payee' | 'subtransactions'
> & {
  category: string | null;
  notes?: string | null;
  imported_id?: string | null;
  imported_payee?: string | null;
};

// Payees by lowercased name: the existing ones and every one this plan
// creates, so a name used by two rows or two accounts becomes one payee
type PayeeNames = {
  idByName: Map<string, string>;
  created: PlannedPayee[];
};

type PlanContext = {
  // Existing accounts and the new ones, for rules and budget checks
  accountsById: Map<string, db.DbAccount>;
  payees: PayeeNames;
  // The transfer payee of each new account
  transferPayeeIdByAccountId: Map<string, string>;
  // Every transfer payee, existing and new, to the account it pays into
  transferAccountIdByPayeeId: Map<string, string>;
};

const STARTING_BALANCE_PAYEE = 'Starting Balance';

// Step 1 of Create (D6): validate, then build every row to insert while
// reading the database and never writing to it
export async function planCreate(input: SetupCreateInput): Promise<CreatePlan> {
  const review = validateInput(input);
  const accounts = await planAccounts(input.accounts);
  // createAccount gives every account a transfer payee
  const transferPayees = accounts.map(account => ({
    id: uuidv4(),
    name: '',
    transfer_acct: account.id,
  }));
  const context: PlanContext = {
    accountsById: await accountsForRules(accounts),
    payees: await loadPayeeNames(),
    transferPayeeIdByAccountId: new Map(
      transferPayees.map(payee => [payee.transfer_acct, payee.id]),
    ),
    transferAccountIdByPayeeId: await existingTransferPayees(),
  };
  for (const payee of transferPayees) {
    context.transferAccountIdByPayeeId.set(payee.id, payee.transfer_acct);
  }
  const startingCategory = await getStartingBalanceCategory();
  const pairedRowIds = new Set(
    input.confirmedPairs.flatMap(pair => [pair.outRowId, pair.inRowId]),
  );
  const now = Date.now();

  const transactions: PlannedTransaction[] = [];
  const transactionByRowId = new Map<string, PlannedTransaction>();
  for (const [index, account] of accounts.entries()) {
    const reviewed = review.accounts[index];
    const starting = startingBalanceTransaction(
      account,
      reviewed,
      startingCategory,
      context.payees,
    );
    if (starting) {
      transactions.push(starting);
    }
    const imported = await importedTransactions(
      account,
      reviewed.rows,
      pairedRowIds,
      context,
      now,
    );
    transactions.push(...imported.transactions);
    for (const [rowId, transaction] of imported.byRowId) {
      transactionByRowId.set(rowId, transaction);
    }
  }

  linkConfirmedPairs(input.confirmedPairs, transactionByRowId, context);
  transactions.push(...(await transferCounterparts(transactions, context)));

  // As createNewPayees does in the import: only payees a row ended up using
  const usedPayeeIds = new Set(transactions.map(t => t.payee));
  return {
    accounts,
    payees: [
      ...transferPayees,
      ...context.payees.created.filter(payee => usedPayeeIds.has(payee.id)),
    ],
    transactions,
    accountIdByDraftId: Object.fromEntries(
      input.accounts.map((draft, index) => [draft.id, accounts[index].id]),
    ),
    transactionCount: transactionByRowId.size,
  };
}

function validateInput(input: SetupCreateInput): Review {
  if (input.accounts.length === 0) {
    throw new SetupValidationError('There are no accounts to create.');
  }
  if (input.accounts.some(draft => draft.name.trim() === '')) {
    throw new SetupValidationError('Every account needs a name.');
  }

  const review = buildReview(input.accounts, input.today);
  if (!review.ready) {
    throw new SetupValidationError(
      'Some accounts still need columns or a balance.',
    );
  }

  const rowsById = new Map<string, { draftId: string; row: SetupRow }>();
  for (const reviewed of review.accounts) {
    for (const row of reviewed.rows) {
      rowsById.set(row.id, { draftId: reviewed.draftId, row });
    }
  }

  // validateTransferPair checks one pair; a row may also be in only one
  const pairedRowIds = new Set<string>();
  for (const pair of input.confirmedPairs) {
    if (!validateTransferPair(pair, rowsById)) {
      throw new SetupValidationError(
        'A confirmed transfer no longer matches its transactions.',
      );
    }
    for (const rowId of [pair.outRowId, pair.inRowId]) {
      if (pairedRowIds.has(rowId)) {
        throw new SetupValidationError(
          'A transaction is in more than one confirmed transfer.',
        );
      }
      pairedRowIds.add(rowId);
    }
  }

  return review;
}

// Each new account goes after the existing accounts in its on-budget or
// off-budget set, and after the new accounts placed before it, as
// insertAccount (server/db/index.ts) places one account at a time
async function planAccounts(
  drafts: SetupAccountDraft[],
): Promise<PlannedAccount[]> {
  const sets: Record<0 | 1, Array<Pick<db.DbAccount, 'id' | 'sort_order'>>> = {
    0: await existingSortOrders(0),
    1: await existingSortOrders(1),
  };

  return drafts.map(draft => {
    const offbudget = draft.offbudget ? 1 : 0;
    const set = sets[offbudget];
    const { sort_order } = shoveSortOrders(set);
    const account: PlannedAccount = {
      id: uuidv4(),
      name: draft.name.trim(),
      offbudget,
      closed: 0,
      sort_order,
      account_group_id: null,
    };
    set.push({ id: account.id, sort_order });
    return account;
  });
}

// The query insertAccount uses, including closed and deleted accounts
function existingSortOrders(offbudget: 0 | 1) {
  return db.all<Pick<db.DbAccount, 'id' | 'sort_order'>>(
    'SELECT id, sort_order FROM accounts WHERE offbudget = ? ORDER BY sort_order, name',
    [offbudget],
  );
}

async function loadPayeeNames(): Promise<PayeeNames> {
  const rows = await db.all<Pick<db.DbPayee, 'id' | 'name'>>(
    'SELECT id, name FROM payees WHERE tombstone = 0',
  );
  const idByName = new Map<string, string>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (!idByName.has(key)) {
      idByName.set(key, row.id);
    }
  }
  return { idByName, created: [] };
}

// Matches by case-insensitive name, as the import's resolvePayee and
// createPayee do against the database, and plans a payee when none matches
function payeeIdForName(payees: PayeeNames, name: string): string {
  const key = name.toLowerCase();
  const existing = payees.idByName.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const payee = { id: uuidv4(), name };
  payees.idByName.set(key, payee.id);
  payees.created.push(payee);
  return payee.id;
}

// The fields createAccount sets, dated and valued by the review
function startingBalanceTransaction(
  account: PlannedAccount,
  reviewed: ReviewAccount,
  startingCategory: string | null,
  payees: PayeeNames,
): PlannedTransaction | null {
  // createAccount creates no transaction for a zero balance
  if (reviewed.starting === null || reviewed.starting.amount === 0) {
    return null;
  }
  return {
    id: uuidv4(),
    account: account.id,
    amount: reviewed.starting.amount,
    category: account.offbudget === 1 ? null : startingCategory,
    payee: payeeIdForName(payees, STARTING_BALANCE_PAYEE),
    date: reviewed.starting.date,
    cleared: true,
    starting_balance_flag: true,
  };
}

async function importedTransactions(
  account: PlannedAccount,
  rows: SetupRow[],
  pairedRowIds: Set<string>,
  context: PlanContext,
  now: number,
): Promise<{
  transactions: PlannedTransaction[];
  byRowId: Map<string, PlannedTransaction>;
}> {
  const added: PlannedTransaction[] = [];
  const byRowId = new Map<string, PlannedTransaction>();
  for (const row of rows) {
    const planned = await importedTransaction(
      account,
      row,
      pairedRowIds.has(row.id),
      context,
    );
    if (planned.length > 0) {
      byRowId.set(row.id, planned[0]);
      added.push(...planned);
    }
  }
  // As reconcileTransactions does: the first row gets the highest sort
  // order; split children keep the 0, -1, ... that makeSplitTransaction set
  added.forEach((transaction, index) => {
    transaction.sort_order ??= now - index * TRANSACTION_SORT_INCREMENT;
  });
  return { transactions: added, byRowId };
}

// One imported row as normalizeTransactions, matchTransactions and
// reconcileTransactions build it: payee resolved by name, rules run, split
// if a rule split it. Returns [] when a rule deleted the row.
async function importedTransaction(
  account: PlannedAccount,
  row: SetupRow,
  isPaired: boolean,
  context: PlanContext,
): Promise<PlannedTransaction[]> {
  const payeeName = normalizeImportedPayeeName(row.payeeName, 'title-case');
  const importedPayee = row.importedPayee || payeeName || null;
  const ruled: TransactionForRules = await runRules(
    {
      account: account.id,
      date: row.date,
      amount: row.amount,
      payee: payeeName ? payeeIdForName(context.payees, payeeName) : null,
      imported_payee: importedPayee ? importedPayee.trim() : null,
      notes: row.notes,
      imported_id: row.importedId,
      category: null,
      cleared: true,
    },
    context.accountsById,
    { resolvePayeeNames: false },
  );
  // The delete-transaction action; reconcileTransactions skips such rows
  if (ruled.tombstone) {
    return [];
  }

  const {
    subtransactions,
    payee_name: _payeeName,
    tombstone: _tombstone,
    ...rest
  } = ruled;
  const transaction: PlannedTransaction = {
    ...rest,
    id: uuidv4(),
    payee: rulePayee(ruled, context.payees),
    category: ruled.category || null,
    cleared: ruled.cleared ?? true,
  };

  // A confirmed pair keeps the row whole so it can be linked as a transfer
  const planned: PlannedTransaction[] =
    !isPaired && subtransactions && subtransactions.length > 0
      ? makeSplitTransaction(
          transaction,
          subtransactions.map((child: TransactionForRules) => {
            const { payee_name: _childPayeeName, ...childRest } = child;
            return child.payee === 'new'
              ? { ...childRest, payee: rulePayee(child, context.payees) }
              : childRest;
          }),
        ).map(split => ({ ...split, category: split.category ?? null }))
      : [transaction];

  // As batchUpdateTransactions does on insert: no category on split
  // parents or in off-budget accounts
  for (const plannedTransaction of planned) {
    if (plannedTransaction.is_parent || account.offbudget === 1) {
      plannedTransaction.category = null;
    }
  }
  return planned;
}

// runRules with resolvePayeeNames off leaves a rule-set name as payee 'new'
// and payee_name. Resolve it against the in-memory payees, as
// resolvePayeeNameForRules would against the database: case-insensitive,
// and a new payee keeps the name exactly as the rule set it.
function rulePayee(
  transaction: TransactionForRules,
  payees: PayeeNames,
): string | null {
  if (transaction.payee !== 'new') {
    return transaction.payee ?? null;
  }
  return transaction.payee_name
    ? payeeIdForName(payees, transaction.payee_name)
    : null;
}

// As "make transfer" links two rows: transfer_id both ways, each payee set
// to the other account's transfer payee. transfer.ts clears the category
// only when both accounts are on budget or both are off budget.
function linkConfirmedPairs(
  pairs: TransferPair[],
  transactionByRowId: Map<string, PlannedTransaction>,
  context: PlanContext,
) {
  for (const pair of pairs) {
    const out = transactionByRowId.get(pair.outRowId);
    const into = transactionByRowId.get(pair.inRowId);
    // A rule deleted one side; the other imports as an ordinary row
    if (out === undefined || into === undefined) {
      continue;
    }
    out.transfer_id = into.id;
    into.transfer_id = out.id;
    out.payee = context.transferPayeeIdByAccountId.get(into.account) ?? null;
    into.payee = context.transferPayeeIdByAccountId.get(out.account) ?? null;
    if (
      isOffBudget(context, out.account) === isOffBudget(context, into.account)
    ) {
      out.category = null;
      into.category = null;
    }
  }
}

// As transfer.onInsert and addTransfer handle a row inserted with a
// transfer payee: a counterpart in the other account with cleared false,
// taking only notes, cleared and schedule from its own rules
async function transferCounterparts(
  transactions: PlannedTransaction[],
  context: PlanContext,
): Promise<PlannedTransaction[]> {
  const counterparts: PlannedTransaction[] = [];
  for (const transaction of transactions) {
    const transferredAccount = transaction.payee
      ? context.transferAccountIdByPayeeId.get(transaction.payee)
      : undefined;
    // addTransfer skips split parents; linked pairs already have their row
    if (
      transferredAccount === undefined ||
      transaction.transfer_id ||
      transaction.is_parent
    ) {
      continue;
    }

    const base = {
      account: transferredAccount,
      amount: -transaction.amount,
      payee:
        context.transferPayeeIdByAccountId.get(transaction.account) ?? null,
      date: transaction.date,
      transfer_id: transaction.id,
      notes: transaction.notes || null,
      cleared: false,
      ...(transaction.schedule ? { schedule: transaction.schedule } : {}),
    };
    const { notes, cleared, schedule } = await runRules(
      base,
      context.accountsById,
      { resolvePayeeNames: false },
    );
    const matchedSchedule = schedule ?? transaction.schedule;
    const counterpart: PlannedTransaction = {
      ...base,
      id: uuidv4(),
      notes,
      cleared,
      category: null,
      ...(matchedSchedule ? { schedule: matchedSchedule } : {}),
    };

    transaction.transfer_id = counterpart.id;
    if (matchedSchedule) {
      transaction.schedule = matchedSchedule;
    }
    if (
      isOffBudget(context, transaction.account) ===
      isOffBudget(context, transferredAccount)
    ) {
      transaction.category = null;
    }
    counterparts.push(counterpart);
  }
  return counterparts;
}

async function accountsForRules(
  planned: PlannedAccount[],
): Promise<Map<string, db.DbAccount>> {
  const accountsById = new Map<string, db.DbAccount>(
    (await db.getAccounts()).map(account => [account.id, account]),
  );
  for (const account of planned) {
    accountsById.set(account.id, { ...account, tombstone: 0 });
  }
  return accountsById;
}

// The payees transfer.ts treats as transfers: v_payees leaves out those
// whose account was deleted
async function existingTransferPayees(): Promise<Map<string, string>> {
  const rows = await db.all<{ id: string; transfer_acct: string }>(
    'SELECT id, transfer_acct FROM v_payees WHERE transfer_acct IS NOT NULL',
  );
  return new Map(rows.map(row => [row.id, row.transfer_acct]));
}

function isOffBudget(context: PlanContext, accountId: string): boolean {
  return context.accountsById.get(accountId)?.offbudget === 1;
}
