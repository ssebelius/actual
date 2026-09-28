import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { handlers } from '#server/main';
import { isMutating } from '#server/mutators';
import { addSyncListener, setSyncingMode } from '#server/sync';
import { insertRule, loadRules } from '#server/transactions/transaction-rules';
import { clearUndo, undo, withUndo } from '#server/undo';
import type { SetupAccountDraft, SetupRow } from '#shared/bank-file-setup';

import { app } from './app';
import type { SetupCreateInput } from './plan-create';

const TODAY = '2026-02-01';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  clearUndo();
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'starting',
    name: 'Starting Balances',
    cat_group: 'income',
    is_income: 1,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  setSyncingMode('disabled');
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
  patch: Partial<SetupAccountDraft>,
): SetupAccountDraft {
  return {
    id,
    name,
    bank: 'Chase',
    type: 'checking',
    offbudget: false,
    entered: null,
    files: [
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

// Starting balance 250000 - (-450 + 200000) = 50450 on 2026-01-05
function checking() {
  return account(
    'd-checking',
    'Chase Checking',
    'f-checking',
    [
      row('f-checking', 0, '2026-01-05', -450, 'COFFEE SHOP'),
      row('f-checking', 1, '2026-01-10', 200000, 'ACME PAYROLL'),
    ],
    { entered: 250000 },
  );
}

// 10000 owed: starting balance -10000 - (-2500) = -7500 on 2026-01-07
function card() {
  return account(
    'd-card',
    'Chase Card',
    'f-card',
    [row('f-card', 0, '2026-01-07', -2500, 'GROCER')],
    { type: 'credit', entered: 10000 },
  );
}

function input(
  confirmedPairs: SetupCreateInput['confirmedPairs'] = [],
): SetupCreateInput {
  return { accounts: [checking(), card()], confirmedPairs, today: TODAY };
}

async function countRows(table: string, where = '1 = 1') {
  const result = await db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`,
  );
  return result?.count ?? 0;
}

async function aliveCounts() {
  return {
    accounts: await countRows('accounts', 'tombstone = 0'),
    payees: await countRows('payees', 'tombstone = 0'),
    transactions: await countRows('transactions', 'tombstone = 0'),
  };
}

describe('setup-parse-file', () => {
  test('parses bytes and does not queue behind writes', async () => {
    expect(isMutating(app.handlers['setup-parse-file'])).toBe(false);
    expect(isMutating(app.handlers['setup-create'])).toBe(true);

    const csv = 'Date,Payee,Amount\n2026-01-05,Coffee Shop,-4.50\n';
    const result = await app.handlers['setup-parse-file']({
      name: 'checking.csv',
      bytes: new TextEncoder().encode(csv),
      options: { hasHeaderRow: true },
    });

    expect(result).toEqual({
      errors: [],
      transactions: [
        { Date: '2026-01-05', Payee: 'Coffee Shop', Amount: '-4.50' },
      ],
    });
  });

  test('both handlers are registered on the server', () => {
    expect(handlers['setup-parse-file']).toBe(app.handlers['setup-parse-file']);
    expect(handlers['setup-create']).toBe(app.handlers['setup-create']);
  });
});

describe('setup-create', () => {
  test('writes everything as one undo step', async () => {
    // An earlier undoable change, to show where the setup's step ends
    await withUndo(async () => {
      await db.insertPayee({ name: 'Before Setup' });
    });
    const before = await aliveCounts();

    const result = await app.handlers['setup-create'](input());

    expect(result).toEqual({
      ok: true,
      accountIds: [expect.any(String), expect.any(String)],
      transactionCount: 3,
    });
    // loot-core compiles without strictNullChecks, so `!result.ok` does not
    // narrow the union; `in` does
    if ('error' in result) {
      throw new Error(result.error);
    }
    const [checkingId, cardId] = result.accountIds;
    expect(
      await db.all(
        'SELECT id, name, offbudget, closed, account_group_id FROM accounts WHERE tombstone = 0 ORDER BY sort_order',
      ),
    ).toEqual([
      {
        id: checkingId,
        name: 'Chase Checking',
        offbudget: 0,
        closed: 0,
        account_group_id: null,
      },
      {
        id: cardId,
        name: 'Chase Card',
        offbudget: 0,
        closed: 0,
        account_group_id: null,
      },
    ]);
    expect(
      await db.all(
        'SELECT account, amount FROM v_transactions_internal_alive WHERE starting_balance_flag = 1 ORDER BY amount',
      ),
    ).toEqual([
      { account: cardId, amount: -7500 },
      { account: checkingId, amount: 50450 },
    ]);
    // Payee names resolve through payee_mapping, so the mapping rows exist
    expect(
      await db.all(
        `SELECT p.name FROM v_transactions_internal_alive t
           JOIN payees p ON p.id = t.payee
           WHERE t.imported_id IS NOT NULL ORDER BY t.imported_id`,
      ),
    ).toEqual([
      { name: 'Grocer' },
      { name: 'Coffee Shop' },
      { name: 'Acme Payroll' },
    ]);
    const transferAccounts = await db.all<{ transfer_acct: string }>(
      'SELECT transfer_acct FROM payees WHERE transfer_acct IS NOT NULL AND tombstone = 0',
    );
    expect(transferAccounts.map(p => p.transfer_acct).sort()).toEqual(
      [checkingId, cardId].sort(),
    );

    // One undo reverts all of it and nothing before it
    await undo();
    expect(await aliveCounts()).toEqual(before);
    expect(
      await countRows('payees', "name = 'Before Setup' AND tombstone = 0"),
    ).toBe(1);

    await undo();
    expect(
      await countRows('payees', "name = 'Before Setup' AND tombstone = 0"),
    ).toBe(0);
  });

  test('a failure while writing leaves the budget and the sync log unchanged', async () => {
    // Offline mode writes every local change to messages_crdt, the log
    // that sync uploads, without contacting a server
    setSyncingMode('offline');
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'COFFEE SHOP' }],
      actions: [{ op: 'set', field: 'payee_name', value: 'Blue Bottle' }],
    });
    const tables = [
      'accounts',
      'payees',
      'payee_mapping',
      'transactions',
      'messages_crdt',
    ];
    const before = await Promise.all(tables.map(table => countRows(table)));

    const insertTransaction = db.insertTransaction;
    let calls = 0;
    vi.spyOn(db, 'insertTransaction').mockImplementation(transaction => {
      calls++;
      if (calls === 3) {
        throw new Error('disk full');
      }
      return insertTransaction(transaction);
    });
    vi.spyOn(console, 'error').mockReturnValue(undefined);

    const result = await app.handlers['setup-create'](input());

    expect(result).toEqual({ ok: false, error: 'disk full' });
    expect(await Promise.all(tables.map(table => countRows(table)))).toEqual(
      before,
    );
    // The rule's payee was only ever planned
    expect(await countRows('payees', "name = 'Blue Bottle'")).toBe(0);

    // Nothing from the discarded batch is still buffered: the next write
    // sends only its own messages
    vi.mocked(db.insertTransaction).mockRestore();
    await db.insertAccount({ id: 'after-failure', name: 'After' });
    expect(await countRows('messages_crdt', "row != 'after-failure'")).toBe(
      before[tables.indexOf('messages_crdt')],
    );
    expect(await countRows('accounts')).toBe(before[0] + 1);
  });

  test('a failure between payee inserts sends nothing after the batch is discarded', async () => {
    // If payees were inserted concurrently, the first payee's mapping insert
    // would still be pending when the second throws, and would reach
    // messages_crdt after the batch was discarded
    setSyncingMode('offline');
    const before = await countRows('messages_crdt');

    const insertPayee = db.insertPayee;
    let calls = 0;
    vi.spyOn(db, 'insertPayee').mockImplementation(payee => {
      calls++;
      if (calls === 2) {
        throw new Error('disk full');
      }
      return insertPayee(payee);
    });
    vi.spyOn(console, 'error').mockReturnValue(undefined);

    const result = await app.handlers['setup-create'](input());

    expect(result).toEqual({ ok: false, error: 'disk full' });
    expect(await countRows('payee_mapping')).toBe(0);
    expect(await countRows('messages_crdt')).toBe(before);
  });

  test('rejects a confirmed transfer whose rows no longer match', async () => {
    const result = await app.handlers['setup-create'](
      // -450 out and -2500 in: stale since the card file was remapped
      input([{ outRowId: 'f-checking:0', inRowId: 'f-card:0' }]),
    );

    expect(result).toEqual({
      ok: false,
      error: 'A confirmed transfer no longer matches its transactions.',
    });
    expect(await countRows('accounts')).toBe(0);
  });

  test('reports success with a warning when work after the commit fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockReturnValue(undefined);
    // Sync listeners run after the batch's SQLite transaction has committed
    const unlisten = addSyncListener(() => {
      throw new Error('listener failed');
    });

    try {
      const result = await app.handlers['setup-create'](input());

      expect(result).toEqual({
        ok: true,
        accountIds: [expect.any(String), expect.any(String)],
        transactionCount: 3,
        warning: 'listener failed',
      });
    } finally {
      unlisten();
    }
    expect(await countRows('accounts', 'tombstone = 0')).toBe(2);
    expect(consoleError).toHaveBeenCalled();
  });
});
