// Measures what Create will cost at 5,000 transactions (technical design
// D10): rules for every row, then one batch of raw inserts and the
// applyMessages it ends in. Skipped unless SETUP_SPIKE=1:
//
//   SETUP_SPIKE=1 yarn workspace @actual-app/core run test:node src/server/bank-file-setup/create-cost.spike.test.ts
//
// Set SETUP_SPIKE_CSV=/absolute/path.csv to also write the generated rows as
// a CSV, for timing the same data through the per-account import in the
// browser.
import * as nativeFs from 'fs';

import { createAllBudgets } from '#server/budget/base';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as sheet from '#server/sheet';
import { batchMessages, setSyncingMode } from '#server/sync';
import {
  insertRule,
  loadRules,
  runRules,
} from '#server/transactions/transaction-rules';
import type { TransactionEntity } from '#types/models';

const { restoreDateNow, restoreFakeDateNow } = global as typeof globalThis & {
  restoreDateNow: () => void;
  restoreFakeDateNow: () => void;
};

const ROWS = 5000;
const GATE_MS = 10_000;

// The accounts Create would make, as rows; share is the part of ROWS each gets
const ACCOUNTS: Array<{ row: db.DbAccount; share: number }> = [
  { row: accountRow('spike-checking', 'Checking', 0, 1), share: 0.5 },
  { row: accountRow('spike-card', 'Card', 0, 2), share: 0.4 },
  { row: accountRow('spike-savings', 'Savings', 1, 3), share: 0.1 },
];

function accountRow(
  id: string,
  name: string,
  offbudget: 0 | 1,
  position: number,
): db.DbAccount {
  return {
    id,
    name,
    offbudget,
    closed: 0,
    tombstone: 0,
    sort_order: position * 16384,
    account_group_id: null,
  };
}

// 40 merchants; the first 12 already exist as payees and have rules
const MERCHANTS = Array.from({ length: 40 }, (_, i) => `MERCHANT${i}`);
const RULED = 12;

type SpikeRow = {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee: string;
  imported_payee: string;
  imported_id: string;
  notes: string | null;
  category: string | null;
  cleared: boolean;
};

// Deterministic, so every run measures the same data
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function dayOffset(start: string, days: number): string {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function generateRows(payeeIdByMerchant: Map<string, string>): SpikeRow[] {
  const random = makeRandom(42);
  const rows: SpikeRow[] = [];
  for (const { row: account, share } of ACCOUNTS) {
    const count = Math.round(ROWS * share);
    for (let i = 0; i < count; i++) {
      const merchant = MERCHANTS[Math.floor(random() * MERCHANTS.length)];
      rows.push({
        id: `${account.id}-row-${i}`,
        account: account.id,
        // Two years of history
        date: dayOffset('2024-09-27', Math.floor(random() * 730)),
        amount: -Math.floor(random() * 20000) - 100,
        payee: payeeIdByMerchant.get(merchant) ?? '',
        imported_payee: `${merchant} STORE ${Math.floor(random() * 900) + 100}`,
        imported_id: `${account.id}-fitid-${i}`,
        notes: null,
        category: null,
        cleared: true,
      });
    }
  }
  return rows;
}

async function seedBudget() {
  await db.insertCategoryGroup({ id: 'spike-group', name: 'Spending' });
  await db.insertCategoryGroup({
    id: 'spike-income',
    name: 'Income',
    is_income: 1,
  });
  await db.insertCategory({
    id: 'spike-starting',
    name: 'Starting Balances',
    cat_group: 'spike-income',
    is_income: 1,
  });
  for (let i = 0; i < RULED; i++) {
    await db.insertCategory({
      id: `spike-cat-${i}`,
      name: `Category ${i}`,
      cat_group: 'spike-group',
    });
    await db.insertPayee({ id: `spike-payee-${i}`, name: `Merchant ${i}` });
  }

  // 36 rules: 12 renames, 12 categories by payee, 6 notes, 6 by amount
  for (let i = 0; i < RULED; i++) {
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'contains', field: 'imported_payee', value: `MERCHANT${i} ` },
      ],
      actions: [{ op: 'set', field: 'payee', value: `spike-payee-${i}` }],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: `spike-payee-${i}` }],
      actions: [{ op: 'set', field: 'category', value: `spike-cat-${i}` }],
    });
  }
  for (let i = 0; i < 6; i++) {
    await insertRule({
      stage: 'post',
      conditionsOp: 'and',
      conditions: [
        {
          op: 'contains',
          field: 'imported_payee',
          value: `MERCHANT${RULED + i} `,
        },
      ],
      actions: [{ op: 'set', field: 'notes', value: `note ${i}` }],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        {
          op: 'contains',
          field: 'imported_payee',
          value: `MERCHANT${RULED + 6 + i} `,
        },
        { op: 'lt', field: 'amount', value: -10000 },
      ],
      actions: [{ op: 'set', field: 'category', value: `spike-cat-${i}` }],
    });
  }
}

function report(lines: Array<[string, string]>) {
  const width = Math.max(...lines.map(([label]) => label.length));
  process.stderr.write(
    '\nCreate cost spike (node backend)\n' +
      lines
        .map(([label, value]) => `  ${label.padEnd(width)}  ${value}`)
        .join('\n') +
      '\n\n',
  );
}

describe.skipIf(process.env.SETUP_SPIKE !== '1')('Create cost spike', () => {
  beforeEach(async () => {
    // The budget months follow the current month; place it after the data
    global.currentMonth = '2026-09';
    await global.emptyDatabase()();
    await loadMappings();
    await loadRules();
    await sheet.loadSpreadsheet(db);
    // Real timestamps: 75,000 messages at one fake millisecond would
    // overflow the HLC counter
    restoreDateNow();
    // Write messages_crdt and the merkle as a real budget does, without
    // trying to reach a sync server
    setSyncingMode('offline');
  });

  afterEach(() => {
    global.currentMonth = null;
    setSyncingMode('disabled');
    restoreFakeDateNow();
  });

  test(`rules and one batch for ${ROWS} rows across ${ACCOUNTS.length} accounts`, async () => {
    await seedBudget();
    await createAllBudgets();
    await sheet.waitOnSpreadsheet();

    const newPayees = MERCHANTS.slice(RULED).map((merchant, i) => ({
      id: `spike-new-payee-${i}`,
      name: `Merchant ${RULED + i}`,
      merchant,
    }));
    const payeeIdByMerchant = new Map([
      ...MERCHANTS.slice(0, RULED).map(
        (merchant, i) => [merchant, `spike-payee-${i}`] as const,
      ),
      ...newPayees.map(payee => [payee.merchant, payee.id] as const),
    ]);
    const rows = generateRows(payeeIdByMerchant);
    expect(rows).toHaveLength(ROWS);

    if (process.env.SETUP_SPIKE_CSV) {
      nativeFs.writeFileSync(
        process.env.SETUP_SPIKE_CSV,
        'Date,Description,Amount\n' +
          rows
            .map(
              row =>
                `${row.date},${row.imported_payee},${(row.amount / 100).toFixed(2)}`,
            )
            .join('\n') +
          '\n',
      );
    }

    // Step 1's rules, against an accounts map that holds the new accounts
    const accountsMap = new Map(ACCOUNTS.map(({ row }) => [row.id, row]));
    const rulesStart = performance.now();
    const ruled: TransactionEntity[] = [];
    for (const row of rows) {
      ruled.push(await runRules(row, accountsMap));
    }
    const rulesMs = performance.now() - rulesStart;
    const categorized = ruled.filter(row => row.category != null).length;

    // Step 2: one batch of raw inserts
    const batchStart = performance.now();
    let builtAt = 0;
    await batchMessages(async () => {
      for (const { row: account } of ACCOUNTS) {
        await db.insertWithUUID('accounts', account);
        await db.insertPayee({
          id: `spike-transfer-${account.id}`,
          name: '',
          transfer_acct: account.id,
        });
      }
      await db.insertPayee({
        id: 'spike-starting-payee',
        name: 'Starting Balance',
      });
      for (const payee of newPayees) {
        await db.insertPayee({ id: payee.id, name: payee.name });
      }
      for (const { row: account } of ACCOUNTS) {
        await db.insertTransaction({
          id: `${account.id}-starting`,
          account: account.id,
          amount: 100000,
          category: account.offbudget ? null : 'spike-starting',
          payee: 'spike-starting-payee',
          date: '2024-09-27',
          cleared: true,
          starting_balance_flag: true,
        });
      }
      const now = Date.now();
      for (const [i, row] of ruled.entries()) {
        await db.insertTransaction({
          ...row,
          sort_order: now - i * 1024,
        });
      }
      builtAt = performance.now();
    });
    const appliedAt = performance.now();
    const buildMs = builtAt - batchStart;
    const applyMs = appliedAt - builtAt;

    // Work after the commit: budget months for two years, then the sheet
    const postStart = performance.now();
    await createAllBudgets();
    await sheet.waitOnSpreadsheet();
    const postMs = performance.now() - postStart;
    const monthCount = sheet.get().meta().createdMonths.size;

    const [{ count: messageCount }] = await db.all<{ count: number }>(
      'SELECT COUNT(*) AS count FROM messages_crdt',
    );
    const [{ count: transactionCount }] = await db.all<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions WHERE tombstone = 0',
    );

    const gateMs = rulesMs + buildMs + applyMs;
    report([
      ['rows', String(ROWS)],
      ['rules', '36'],
      ['rows a rule categorized', String(categorized)],
      ['runRules total', `${rulesMs.toFixed(0)} ms`],
      ['runRules per row', `${(rulesMs / ROWS).toFixed(2)} ms`],
      ['batch: build messages', `${buildMs.toFixed(0)} ms`],
      ['batch: applyMessages', `${applyMs.toFixed(0)} ms`],
      ['messages written', String(messageCount)],
      ['budget months after commit', String(monthCount)],
      ['after commit: budgets + sheet', `${postMs.toFixed(0)} ms`],
      ['gate: rules + batch', `${gateMs.toFixed(0)} ms (limit ${GATE_MS})`],
    ]);

    expect(transactionCount).toBe(ROWS + ACCOUNTS.length);
    expect(gateMs).toBeLessThan(GATE_MS);
  }, 300_000);
});
