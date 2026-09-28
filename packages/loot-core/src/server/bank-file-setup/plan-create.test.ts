import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { insertRule, loadRules } from '#server/transactions/transaction-rules';
import type { SetupAccountDraft, SetupRow } from '#shared/bank-file-setup';

import { planCreate, SetupValidationError } from './plan-create';
import type { CreatePlan, SetupCreateInput } from './plan-create';

const TODAY = '2026-02-01';
// Date.now() is fixed at 123456789 in tests (src/mocks/setup.ts)
const NOW = 123456789;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'starting',
    name: 'Starting Balances',
    cat_group: 'income',
    is_income: 1,
  });
  await db.insertCategoryGroup({ id: 'spending', name: 'Spending' });
  await db.insertCategory({
    id: 'groceries',
    name: 'Groceries',
    cat_group: 'spending',
  });
  await db.insertCategory({
    id: 'household',
    name: 'Household',
    cat_group: 'spending',
  });
  await db.insertCategory({
    id: 'investing',
    name: 'Investing',
    cat_group: 'spending',
  });
});

function row(
  fileId: string,
  index: number,
  date: string,
  amount: number,
  payeeName: string,
): SetupRow {
  return {
    id: `${fileId}:${index}`,
    fileId,
    date,
    amount,
    payeeName,
    importedPayee: payeeName,
    notes: null,
    importedId: `${fileId}-${index}`,
  };
}

function account(
  id: string,
  name: string,
  fileId: string,
  rows: SetupRow[],
  patch: Partial<SetupAccountDraft> = {},
): SetupAccountDraft {
  return {
    id,
    name,
    bank: 'Chase',
    type: 'checking',
    offbudget: false,
    entered: null,
    files:
      rows.length === 0
        ? []
        : [
            {
              id: fileId,
              name: `${fileId}.qfx`,
              format: 'qfx',
              rows,
              statement: null,
              csvBalance: null,
              needsMapping: false,
            },
          ],
    ...patch,
  };
}

// Known balance 250000 on 2026-01-10, the last row, so the starting
// balance is 250000 - (-450 + 200000) = 50450 on 2026-01-05
function checking(extraRows: SetupRow[] = []) {
  return account(
    'd-checking',
    'Chase Checking',
    'f-checking',
    [
      row('f-checking', 0, '2026-01-05', -450, 'COFFEE SHOP'),
      row('f-checking', 1, '2026-01-10', 200000, 'ACME PAYROLL'),
      ...extraRows,
    ],
    { entered: 250000 },
  );
}

// 10000 owed on 2026-01-07 is stored as -10000, so the starting
// balance is -10000 - (-2500) = -7500 on 2026-01-07
function card(extraRows: SetupRow[] = []) {
  return account(
    'd-card',
    'Chase Card',
    'f-card',
    [row('f-card', 0, '2026-01-07', -2500, 'GROCER'), ...extraRows],
    { type: 'credit', entered: 10000 },
  );
}

function input(
  accounts: SetupAccountDraft[],
  confirmedPairs: SetupCreateInput['confirmedPairs'] = [],
): SetupCreateInput {
  return { accounts, confirmedPairs, today: TODAY };
}

function byImportedId(plan: CreatePlan, importedId: string) {
  const found = plan.transactions.find(t => t.imported_id === importedId);
  if (!found) {
    throw new Error(`No planned transaction with imported_id ${importedId}`);
  }
  return found;
}

function payeeIdByName(plan: CreatePlan, name: string) {
  const found = plan.payees.find(payee => payee.name === name);
  if (!found) {
    throw new Error(`No planned payee named ${name}`);
  }
  return found.id;
}

function createdPayeeNames(plan: CreatePlan) {
  return plan.payees
    .filter(payee => payee.transfer_acct === undefined)
    .map(payee => payee.name)
    .sort();
}

async function countRows(table: string) {
  const result = await db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  return result?.count ?? 0;
}

function transferPayeeOf(plan: CreatePlan, accountId: string) {
  const found = plan.payees.find(payee => payee.transfer_acct === accountId);
  if (!found) {
    throw new Error(`No transfer payee for ${accountId}`);
  }
  return found.id;
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  return items[0];
}

describe('planCreate', () => {
  test('plans two new accounts in an empty budget', async () => {
    const plan = await planCreate(input([checking(), card()]));

    expect(plan.accounts).toEqual([
      {
        id: expect.any(String),
        name: 'Chase Checking',
        offbudget: 0,
        closed: 0,
        sort_order: 16384,
        account_group_id: null,
      },
      {
        id: expect.any(String),
        name: 'Chase Card',
        offbudget: 0,
        closed: 0,
        sort_order: 32768,
        account_group_id: null,
      },
    ]);
    const checkingId = plan.accounts[0].id;
    const cardId = plan.accounts[1].id;
    expect(plan.accountIdByDraftId).toEqual({
      'd-checking': checkingId,
      'd-card': cardId,
    });

    expect(plan.payees.filter(p => p.transfer_acct !== undefined)).toEqual([
      { id: expect.any(String), name: '', transfer_acct: checkingId },
      { id: expect.any(String), name: '', transfer_acct: cardId },
    ]);
    expect(createdPayeeNames(plan)).toEqual([
      'Acme Payroll',
      'Coffee Shop',
      'Grocer',
      'Starting Balance',
    ]);

    const startingPayee = payeeIdByName(plan, 'Starting Balance');
    expect(plan.transactions).toMatchObject([
      {
        account: checkingId,
        amount: 50450,
        date: '2026-01-05',
        payee: startingPayee,
        category: 'starting',
        cleared: true,
        starting_balance_flag: true,
      },
      {
        account: checkingId,
        date: '2026-01-05',
        amount: -450,
        payee: payeeIdByName(plan, 'Coffee Shop'),
        imported_payee: 'COFFEE SHOP',
        imported_id: 'f-checking-0',
        notes: null,
        category: null,
        cleared: true,
        sort_order: NOW,
      },
      {
        account: checkingId,
        date: '2026-01-10',
        amount: 200000,
        payee: payeeIdByName(plan, 'Acme Payroll'),
        imported_payee: 'ACME PAYROLL',
        imported_id: 'f-checking-1',
        category: null,
        cleared: true,
        sort_order: NOW - 1024,
      },
      {
        account: cardId,
        amount: -7500,
        date: '2026-01-07',
        payee: startingPayee,
        category: 'starting',
        starting_balance_flag: true,
      },
      {
        account: cardId,
        amount: -2500,
        payee: payeeIdByName(plan, 'Grocer'),
        imported_id: 'f-card-0',
        sort_order: NOW,
      },
    ]);
    expect(new Set(plan.transactions.map(t => t.id)).size).toBe(5);
    expect(plan.transactionCount).toBe(3);
  });

  test('reuses existing payees by name instead of planning duplicates', async () => {
    await db.insertPayee({ id: 'coffee', name: 'Coffee Shop' });
    await db.insertPayee({ id: 'sb', name: 'Starting Balance' });

    const plan = await planCreate(input([checking()]));

    expect(byImportedId(plan, 'f-checking-0').payee).toBe('coffee');
    expect(
      plan.transactions.find(t => t.starting_balance_flag === true)?.payee,
    ).toBe('sb');
    expect(createdPayeeNames(plan)).toEqual(['Acme Payroll']);
  });

  test('places off-budget accounts after existing off-budget accounts, with no categories', async () => {
    await db.insertAccount({ id: 'old-checking', name: 'Old Checking' });
    await db.insertAccount({
      id: 'old-brokerage',
      name: 'Old Brokerage',
      offbudget: 1,
    });
    // 500000 on 2026-01-20: starting balance 500000 - 10000 = 490000
    const brokerage = account(
      'd-brokerage',
      'Brokerage',
      'f-brokerage',
      [row('f-brokerage', 0, '2026-01-20', 10000, 'DIVIDEND')],
      { type: 'other', offbudget: true, entered: 500000 },
    );
    // No files and a zero balance: an account and no transactions
    const loan = account('d-loan', 'Car Loan', 'f-loan', [], {
      type: 'other',
      offbudget: true,
      entered: 0,
    });

    const plan = await planCreate(input([brokerage, checking(), loan]));

    expect(plan.accounts).toMatchObject([
      { name: 'Brokerage', offbudget: 1, sort_order: 32768 },
      { name: 'Chase Checking', offbudget: 0, sort_order: 32768 },
      { name: 'Car Loan', offbudget: 1, sort_order: 49152 },
    ]);
    const brokerageId = plan.accountIdByDraftId['d-brokerage'];
    const loanId = plan.accountIdByDraftId['d-loan'];
    expect(
      plan.transactions.filter(t => t.account === brokerageId),
    ).toMatchObject([
      {
        amount: 490000,
        date: '2026-01-20',
        category: null,
        starting_balance_flag: true,
      },
      { amount: 10000, imported_id: 'f-brokerage-0', category: null },
    ]);
    expect(plan.transactions.filter(t => t.account === loanId)).toEqual([]);
    expect(plan.payees.filter(p => p.transfer_acct === loanId)).toHaveLength(1);
  });

  test('writes nothing to the database', async () => {
    await db.insertPayee({ id: 'coffee', name: 'Coffee Shop' });
    const tables = ['accounts', 'payees', 'payee_mapping', 'transactions'];
    const before = await Promise.all(tables.map(countRows));

    await planCreate(input([checking(), card()]));

    expect(await Promise.all(tables.map(countRows))).toEqual(before);
  });

  test('rejects accounts that are not ready to create', async () => {
    const unmapped = card();
    unmapped.files = [{ ...unmapped.files[0], rows: [], needsMapping: true }];

    await expect(
      planCreate(input([checking(), unmapped])),
    ).rejects.toBeInstanceOf(SetupValidationError);
    await expect(planCreate(input([]))).rejects.toBeInstanceOf(
      SetupValidationError,
    );
  });

  test('rejects a confirmed pair whose rows are gone or no longer match', async () => {
    // A removed file: the out row no longer exists
    await expect(
      planCreate(
        input(
          [checking(), card()],
          [{ outRowId: 'f-checking:9', inRowId: 'f-card:0' }],
        ),
      ),
    ).rejects.toBeInstanceOf(SetupValidationError);
    // A remapped file: -450 out does not match -2500
    await expect(
      planCreate(
        input(
          [checking(), card()],
          [{ outRowId: 'f-checking:0', inRowId: 'f-card:0' }],
        ),
      ),
    ).rejects.toBeInstanceOf(SetupValidationError);
  });

  test('rejects a row used by two confirmed pairs', async () => {
    const payment = row('f-checking', 2, '2026-01-12', -5000, 'CARD PAYMENT');
    const cardSide = row('f-card', 1, '2026-01-13', 5000, 'PAYMENT THANKS');
    const savings = account(
      'd-savings',
      'Savings',
      'f-savings',
      [row('f-savings', 0, '2026-01-14', 5000, 'TRANSFER IN')],
      { type: 'savings', entered: 5000 },
    );
    // Each pair is valid on its own; together they use the payment twice
    const pairs = [
      { outRowId: payment.id, inRowId: cardSide.id },
      { outRowId: payment.id, inRowId: 'f-savings:0' },
    ];

    await expect(
      planCreate(
        input([checking([payment]), card([cardSide]), savings], pairs),
      ),
    ).rejects.toThrow(/more than one confirmed transfer/);
  });
});

describe('planCreate with rules and transfers', () => {
  test('a rule that renames a payee plans one payee and writes none', async () => {
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'SQ *BLUE BOTTLE' },
      ],
      actions: [{ op: 'set', field: 'payee_name', value: 'Blue Bottle' }],
    });
    const payeesBefore = await countRows('payees');

    const plan = await planCreate(
      input([
        checking([row('f-checking', 2, '2026-01-10', -600, 'SQ *BLUE BOTTLE')]),
        card([row('f-card', 1, '2026-01-07', -700, 'SQ *BLUE BOTTLE')]),
      ]),
    );

    // The title-cased original name is not used by any row, so it is dropped
    expect(createdPayeeNames(plan)).toEqual([
      'Acme Payroll',
      'Blue Bottle',
      'Coffee Shop',
      'Grocer',
      'Starting Balance',
    ]);
    const blueBottle = payeeIdByName(plan, 'Blue Bottle');
    expect(byImportedId(plan, 'f-checking-2').payee).toBe(blueBottle);
    expect(byImportedId(plan, 'f-card-1').payee).toBe(blueBottle);
    expect(await countRows('payees')).toBe(payeesBefore);
  });

  test('a rule that renames to an existing payee reuses it', async () => {
    await db.insertPayee({ id: 'blue-bottle', name: 'Blue Bottle' });
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'SQ *BLUE BOTTLE' },
      ],
      actions: [{ op: 'set', field: 'payee_name', value: 'blue bottle' }],
    });

    const plan = await planCreate(
      input([
        checking([row('f-checking', 2, '2026-01-10', -600, 'SQ *BLUE BOTTLE')]),
      ]),
    );

    expect(byImportedId(plan, 'f-checking-2').payee).toBe('blue-bottle');
    expect(createdPayeeNames(plan)).toEqual([
      'Acme Payroll',
      'Coffee Shop',
      'Starting Balance',
    ]);
  });

  test('a split rule makes a parent and its children', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'COSTCO' }],
      actions: [
        {
          op: 'set-split-amount',
          value: -3000,
          options: { splitIndex: 1, method: 'fixed-amount' },
        },
        {
          op: 'set',
          field: 'category',
          value: 'groceries',
          options: { splitIndex: 1 },
        },
        {
          op: 'set-split-amount',
          value: null,
          options: { splitIndex: 2, method: 'remainder' },
        },
        {
          op: 'set',
          field: 'category',
          value: 'household',
          options: { splitIndex: 2 },
        },
      ],
    });
    const costco = account(
      'd-checking',
      'Chase Checking',
      'f-checking',
      [row('f-checking', 0, '2026-01-08', -10000, 'COSTCO')],
      { entered: 90000 },
    );

    const plan = await planCreate(input([costco]));

    const parent = byImportedId(plan, 'f-checking-0');
    expect(parent).toMatchObject({
      is_parent: true,
      amount: -10000,
      category: null,
      sort_order: NOW,
    });
    // -10000 - (-3000) leaves -7000 for the remainder
    expect(
      plan.transactions.filter(t => t.parent_id === parent.id),
    ).toMatchObject([
      { is_child: true, amount: -3000, category: 'groceries' },
      { is_child: true, amount: -7000, category: 'household' },
    ]);
    expect(plan.transactionCount).toBe(1);
  });

  test('a confirmed pair between an on-budget and an off-budget account keeps the category', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'TRANSFER TO BROKERAGE' },
      ],
      actions: [{ op: 'set', field: 'category', value: 'investing' }],
    });
    const chk = account(
      'd-checking',
      'Chase Checking',
      'f-checking',
      [row('f-checking', 0, '2026-01-12', -50000, 'TRANSFER TO BROKERAGE')],
      { entered: 100000 },
    );
    // 80000 on 2026-01-13: starting balance 80000 - 50000 = 30000
    const brokerage = account(
      'd-brokerage',
      'Brokerage',
      'f-brokerage',
      [row('f-brokerage', 0, '2026-01-13', 50000, 'TRANSFER FROM CHECKING')],
      { type: 'other', offbudget: true, entered: 80000 },
    );

    const plan = await planCreate(
      input(
        [chk, brokerage],
        [{ outRowId: 'f-checking:0', inRowId: 'f-brokerage:0' }],
      ),
    );

    const checkingId = plan.accountIdByDraftId['d-checking'];
    const brokerageId = plan.accountIdByDraftId['d-brokerage'];
    const out = byImportedId(plan, 'f-checking-0');
    const into = byImportedId(plan, 'f-brokerage-0');
    expect(out).toMatchObject({
      transfer_id: into.id,
      payee: transferPayeeOf(plan, brokerageId),
      category: 'investing',
    });
    expect(into).toMatchObject({
      transfer_id: out.id,
      payee: transferPayeeOf(plan, checkingId),
      category: null,
    });
    // Two starting balances and the two linked rows; no third transfer row
    expect(plan.transactions).toHaveLength(4);
  });

  test('a confirmed pair between two on-budget accounts clears the category', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'CARD PAYMENT' },
      ],
      actions: [{ op: 'set', field: 'category', value: 'household' }],
    });
    const payment = row('f-checking', 2, '2026-01-12', -5000, 'CARD PAYMENT');
    const cardSide = row('f-card', 1, '2026-01-13', 5000, 'PAYMENT THANKS');

    const plan = await planCreate(
      input(
        [checking([payment]), card([cardSide])],
        [{ outRowId: payment.id, inRowId: cardSide.id }],
      ),
    );

    expect(byImportedId(plan, 'f-checking-2')).toMatchObject({
      transfer_id: byImportedId(plan, 'f-card-1').id,
      category: null,
    });
    expect(byImportedId(plan, 'f-card-1').category).toBeNull();
  });

  test('a rule that sets a transfer payee plans the counterpart, with rules run on it', async () => {
    await db.insertAccount({ id: 'savings', name: 'Savings' });
    await db.insertPayee({
      id: 'transfer-savings',
      name: '',
      transfer_acct: 'savings',
    });
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'TO SAVINGS' }],
      actions: [
        { op: 'set', field: 'payee', value: 'transfer-savings' },
        { op: 'set', field: 'category', value: 'groceries' },
      ],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'account', value: 'savings' }],
      actions: [{ op: 'set', field: 'notes', value: 'Moved from checking' }],
    });
    const chk = account(
      'd-checking',
      'Chase Checking',
      'f-checking',
      [row('f-checking', 0, '2026-01-15', -20000, 'TO SAVINGS')],
      { entered: 100000 },
    );

    const plan = await planCreate(input([chk]));

    const checkingId = plan.accountIdByDraftId['d-checking'];
    const source = byImportedId(plan, 'f-checking-0');
    const counterpart = only(
      plan.transactions.filter(t => t.account === 'savings'),
    );
    expect(counterpart).toMatchObject({
      amount: 20000,
      date: '2026-01-15',
      payee: transferPayeeOf(plan, checkingId),
      transfer_id: source.id,
      cleared: false,
      notes: 'Moved from checking',
    });
    // Both accounts are on budget, so the rule's category is cleared
    expect(source).toMatchObject({
      payee: 'transfer-savings',
      transfer_id: counterpart.id,
      category: null,
    });
    expect(plan.transactionCount).toBe(1);
  });
});
