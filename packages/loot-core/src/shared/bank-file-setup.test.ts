import {
  buildReview,
  dedupeAcrossFiles,
  findTransferPairs,
  knownBalance,
  startingBalance,
  validateTransferPair,
} from './bank-file-setup';
import type {
  SetupAccountDraft,
  SetupFile,
  SetupRow,
  SetupStatement,
} from './bank-file-setup';

function row(
  fileId: string,
  index: number,
  date: string,
  amount: number,
  payeeName: string,
  importedId: string | null = null,
): SetupRow {
  return {
    id: `${fileId}:${index}`,
    fileId,
    date,
    amount,
    payeeName,
    importedPayee: payeeName,
    notes: null,
    importedId,
  };
}

function file(
  id: string,
  rows: SetupRow[],
  patch: Partial<SetupFile> = {},
): SetupFile {
  return {
    id,
    name: `${id}.csv`,
    format: 'csv',
    rows,
    statement: null,
    csvBalance: null,
    needsMapping: false,
    ...patch,
  };
}

function ids(rows: Array<{ id: string }>) {
  return rows.map(r => r.id);
}

const TODAY = '2026-09-27';

function statement(patch: Partial<SetupStatement>): SetupStatement {
  return {
    org: 'Chase',
    accountId: '1234',
    accountType: 'CHECKING',
    start: '2026-03-01',
    end: '2026-03-31',
    ledgerBalance: null,
    ledgerDate: null,
    ...patch,
  };
}

function account(
  id: string,
  files: SetupFile[],
  patch: Partial<SetupAccountDraft> = {},
): SetupAccountDraft {
  return {
    id,
    name: id,
    bank: 'Chase',
    type: 'checking',
    offbudget: false,
    files,
    entered: null,
    ...patch,
  };
}

describe('dedupeAcrossFiles', () => {
  // Review Focus 1
  test('keeps identical purchases within one file', () => {
    const coffees = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('a', 1, '2026-03-02', -450, 'Blue Bottle'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([coffees]);

    expect(ids(kept)).toEqual(['a:0', 'a:1']);
    expect(skipped).toEqual([]);
  });

  // Review Focus 1
  test('skips only the copies of them in a second file', () => {
    const a = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('a', 1, '2026-03-02', -450, 'Blue Bottle'),
      row('a', 2, '2026-03-03', -2000, 'Safeway'),
    ]);
    const b = file('b', [
      row('b', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('b', 1, '2026-03-02', -450, 'Blue Bottle'),
      row('b', 2, '2026-04-01', -150000, 'Rent'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0', 'a:1', 'a:2', 'b:2']);
    expect(skipped).toEqual([
      { row: b.rows[0], keptFromFileId: 'a' },
      { row: b.rows[1], keptFromFileId: 'a' },
    ]);
  });

  test('keeps the largest count of a purchase seen in any single file', () => {
    const a = file('a', [row('a', 0, '2026-03-02', -450, 'Blue Bottle')]);
    const b = file('b', [
      row('b', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('b', 1, '2026-03-02', -450, 'Blue Bottle'),
    ]);
    const c = file('c', [row('c', 0, '2026-03-02', -450, 'Blue Bottle')]);

    const { kept, skipped } = dedupeAcrossFiles([a, b, c]);

    // Two copies at most in one file, so two are kept
    expect(ids(kept)).toEqual(['a:0', 'b:1']);
    expect(skipped).toEqual([
      { row: b.rows[0], keptFromFileId: 'a' },
      { row: c.rows[0], keptFromFileId: 'a' },
    ]);
  });

  test('matches on imported id even when the description differs', () => {
    const a = file('a', [
      row('a', 0, '2026-03-05', -20000, 'CHASE CREDIT CRD AUTOPAY', 'FIT1'),
    ]);
    const b = file('b', [
      row('b', 0, '2026-03-05', -20000, 'Chase autopay', 'FIT1'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0']);
    expect(skipped).toEqual([{ row: b.rows[0], keptFromFileId: 'a' }]);
  });

  test('keeps rows whose imported ids differ, even with the same date, amount and description', () => {
    const a = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle', 'FIT1'),
    ]);
    const b = file('b', [
      row('b', 0, '2026-03-02', -450, 'Blue Bottle', 'FIT2'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0', 'b:0']);
    expect(skipped).toEqual([]);
  });

  test('matches on date, amount and description when only one row has an imported id', () => {
    const ofx = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle', 'FIT1'),
    ]);
    const csv = file('b', [row('b', 0, '2026-03-02', -450, 'Blue Bottle')]);

    const { kept, skipped } = dedupeAcrossFiles([ofx, csv]);

    expect(ids(kept)).toEqual(['a:0']);
    expect(skipped).toEqual([{ row: csv.rows[0], keptFromFileId: 'a' }]);
  });

  test('keeps rows that differ in date, amount or description', () => {
    const a = file('a', [row('a', 0, '2026-03-02', -450, 'Blue Bottle')]);
    const b = file('b', [
      row('b', 0, '2026-03-03', -450, 'Blue Bottle'),
      row('b', 1, '2026-03-02', -451, 'Blue Bottle'),
      row('b', 2, '2026-03-02', -450, 'Blue Bottle Coffee'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0', 'b:0', 'b:1', 'b:2']);
    expect(skipped).toEqual([]);
  });
});

describe('knownBalance', () => {
  const rows = [
    row('a', 0, '2026-03-02', -450, 'Blue Bottle'),
    row('a', 1, '2026-03-28', -2000, 'Safeway'),
  ];

  test('uses an OFX ledger balance dated on the statement end, before a CSV balance or an entered one', () => {
    const checking = account(
      'checking',
      [
        file('ofx', [], {
          format: 'ofx',
          statement: statement({
            ledgerBalance: 150000,
            ledgerDate: '2026-03-31',
          }),
        }),
        file('csv', [], {
          csvBalance: { date: '2026-03-30', amount: 99999 },
        }),
      ],
      { entered: 5000 },
    );

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'ledger',
      amount: 150000,
      date: '2026-03-31',
    });
  });

  test('uses the latest of several usable ledger balances', () => {
    const checking = account('checking', [
      file('feb', [], {
        format: 'ofx',
        statement: statement({
          start: '2026-02-01',
          end: '2026-02-28',
          ledgerBalance: 120000,
          ledgerDate: '2026-02-27',
        }),
      }),
      file('mar', [], {
        format: 'ofx',
        statement: statement({
          ledgerBalance: 150000,
          ledgerDate: '2026-03-31',
        }),
      }),
    ]);

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'ledger',
      amount: 150000,
      date: '2026-03-31',
    });
  });

  // Review Focus 5
  test('does not use a ledger balance dated after the statement end, and asks for the balance on the end date', () => {
    const stale = file('qfx', [], {
      format: 'qfx',
      statement: statement({ ledgerBalance: 150000, ledgerDate: '2026-04-02' }),
    });

    expect(knownBalance(account('checking', [stale]), rows, TODAY)).toEqual({
      kind: 'ledger-after-end',
      ledgerDate: '2026-04-02',
      end: '2026-03-31',
    });
    expect(
      knownBalance(
        account('checking', [stale], { entered: 90000 }),
        rows,
        TODAY,
      ),
    ).toEqual({ source: 'entered', amount: 90000, date: '2026-03-31' });
  });

  test('uses a CSV balance column when no ledger balance is usable', () => {
    const checking = account('checking', [
      file('qfx', [], {
        format: 'qfx',
        statement: statement({
          ledgerBalance: 150000,
          ledgerDate: '2026-04-02',
        }),
      }),
      file('csv', [], { csvBalance: { date: '2026-03-30', amount: 51234 } }),
    ]);

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'csv-balance',
      amount: 51234,
      date: '2026-03-30',
    });
  });

  test('dates an entered balance on the last transaction', () => {
    const checking = account('checking', [file('csv', rows)], {
      entered: 25000,
    });

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'entered',
      amount: 25000,
      date: '2026-03-28',
    });
  });

  test('stores the amount owed on a card as a negative balance', () => {
    const card = account('card', [file('csv', rows)], {
      type: 'credit',
      entered: 112648,
    });

    expect(knownBalance(card, rows, TODAY)).toEqual({
      source: 'entered',
      amount: -112648,
      date: '2026-03-28',
    });
  });

  test('dates an entered balance today for an account with no files', () => {
    expect(
      knownBalance(account('cash', [], { entered: 2000 }), [], TODAY),
    ).toEqual({ source: 'entered', amount: 2000, date: TODAY });
  });

  test('asks for the balance on the last transaction date, or today with no files', () => {
    expect(
      knownBalance(account('checking', [file('csv', rows)]), rows, TODAY),
    ).toEqual({ kind: 'no-balance', asOf: '2026-03-28' });
    expect(knownBalance(account('cash', []), [], TODAY)).toEqual({
      kind: 'no-balance',
      asOf: TODAY,
    });
  });
});

describe('startingBalance', () => {
  test('subtracts the rows dated on or before the known date and dates it on the earliest row', () => {
    const rows = [
      row('a', 0, '2026-03-05', 100000, 'Payroll'),
      row('a', 1, '2026-03-01', -450, 'Blue Bottle'),
      row('a', 2, '2026-03-31', -2000, 'Safeway'),
      row('a', 3, '2026-04-02', -3000, 'Parking'),
    ];

    // 150000 - (100000 - 450 - 2000) = 52450; the April row is after the known date
    expect(
      startingBalance(rows, {
        source: 'ledger',
        amount: 150000,
        date: '2026-03-31',
      }),
    ).toEqual({ amount: 52450, date: '2026-03-01' });
  });

  test('works back from an amount owed on a card', () => {
    const rows = [
      row('s', 0, '2026-09-01', -5000, 'Coffee shop'),
      row('s', 1, '2026-09-20', 20000, 'Payment thank you'),
    ];

    // -112648 - (-5000 + 20000) = -127648, 1,276.48 owed on September 1
    expect(
      startingBalance(rows, {
        source: 'entered',
        amount: -112648,
        date: '2026-09-25',
      }),
    ).toEqual({ amount: -127648, date: '2026-09-01' });
  });

  test('is the known balance on its own date when there are no rows', () => {
    expect(
      startingBalance([], { source: 'entered', amount: 2000, date: TODAY }),
    ).toEqual({ amount: 2000, date: TODAY });
  });
});

describe('findTransferPairs', () => {
  test('pairs money leaving one account with the same amount arriving in another', () => {
    const pairs = findTransferPairs([
      {
        draftId: 'checking',
        rows: [row('c', 0, '2026-03-05', -20000, 'Payment to Sapphire')],
      },
      {
        draftId: 'card',
        rows: [row('s', 0, '2026-03-07', 20000, 'Payment thank you')],
      },
    ]);

    expect(pairs).toEqual([{ outRowId: 'c:0', inRowId: 's:0' }]);
  });

  test('pairs rows 5 days apart but not 6', () => {
    const accounts = (inDate: string) => [
      { draftId: 'checking', rows: [row('c', 0, '2026-03-01', -20000, 'Out')] },
      { draftId: 'card', rows: [row('s', 0, inDate, 20000, 'In')] },
    ];

    expect(findTransferPairs(accounts('2026-03-06'))).toEqual([
      { outRowId: 'c:0', inRowId: 's:0' },
    ]);
    expect(findTransferPairs(accounts('2026-03-07'))).toEqual([]);
  });

  test('ignores rows in the same account, with the same sign, or with different amounts', () => {
    expect(
      findTransferPairs([
        {
          // Opposite signs, but in one account
          draftId: 'checking',
          rows: [
            row('c', 0, '2026-03-05', -500, 'Out'),
            row('c', 1, '2026-03-05', 500, 'Refund'),
          ],
        },
        {
          draftId: 'card',
          rows: [
            // One cent more than c:0
            row('s', 0, '2026-03-05', 501, 'Not quite'),
            row('s', 1, '2026-03-05', -700, 'Out'),
          ],
        },
        {
          // Same sign as s:1
          draftId: 'savings',
          rows: [row('v', 0, '2026-03-05', -700, 'Also out')],
        },
      ]),
    ).toEqual([]);
  });

  test('gives each row at most one pair, taking the closest date', () => {
    const pairs = findTransferPairs([
      {
        draftId: 'checking',
        rows: [
          row('c', 0, '2026-03-10', -10000, 'Out'),
          row('c', 1, '2026-03-12', -10000, 'Out'),
        ],
      },
      { draftId: 'card', rows: [row('s', 0, '2026-03-08', 10000, 'In')] },
      { draftId: 'savings', rows: [row('v', 0, '2026-03-11', 10000, 'In')] },
    ]);

    // c:0 takes v:0 (1 day, closer than s:0 at 2); c:1 is left with s:0 (4 days)
    expect(pairs).toEqual([
      { outRowId: 'c:0', inRowId: 'v:0' },
      { outRowId: 'c:1', inRowId: 's:0' },
    ]);
  });

  test('is deterministic: earlier out-rows choose first and equal distances go to the lower id', () => {
    const accounts = [
      { draftId: 'a', rows: [row('a', 0, '2026-03-08', -10000, 'Out')] },
      { draftId: 'b', rows: [row('b', 0, '2026-03-10', -10000, 'Out')] },
      {
        draftId: 'c',
        rows: [
          row('c', 0, '2026-03-10', 10000, 'In'),
          row('c', 1, '2026-03-06', 10000, 'In'),
        ],
      },
    ];

    // a:0 goes first; c:0 and c:1 are both 2 days away, so it takes c:0.
    // b:0 would have matched c:0 on the same day, but c:0 is taken; c:1 is 4 days away.
    const expected = [
      { outRowId: 'a:0', inRowId: 'c:0' },
      { outRowId: 'b:0', inRowId: 'c:1' },
    ];
    expect(findTransferPairs(accounts)).toEqual(expected);
    expect(findTransferPairs([...accounts].reverse())).toEqual(expected);
  });
});

describe('validateTransferPair', () => {
  const out = {
    draftId: 'checking',
    row: row('c', 0, '2026-03-05', -20000, 'Out'),
  };
  const into = { draftId: 'card', row: row('s', 0, '2026-03-07', 20000, 'In') };
  const pair = { outRowId: 'c:0', inRowId: 's:0' };

  function rowsById(...entries: Array<{ draftId: string; row: SetupRow }>) {
    return new Map(entries.map(entry => [entry.row.id, entry]));
  }

  test('accepts a pair that still matches', () => {
    expect(validateTransferPair(pair, rowsById(out, into))).toBe(true);
  });

  // Review Focus 2
  test('rejects a pair whose file or account was removed', () => {
    expect(validateTransferPair(pair, rowsById(out))).toBe(false);
    expect(validateTransferPair(pair, rowsById(into))).toBe(false);
  });

  // Review Focus 2
  test('rejects a pair whose amounts changed after the CSV was remapped', () => {
    const remapped = { ...into, row: { ...into.row, amount: 19999 } };
    const flipped = { ...into, row: { ...into.row, amount: -20000 } };

    expect(validateTransferPair(pair, rowsById(out, remapped))).toBe(false);
    expect(validateTransferPair(pair, rowsById(out, flipped))).toBe(false);
  });

  test('rejects a pair in one account, more than 5 days apart, or with its sides swapped', () => {
    const sameAccount = { ...into, draftId: 'checking' };
    const late = { ...into, row: { ...into.row, date: '2026-03-11' } };

    expect(validateTransferPair(pair, rowsById(out, sameAccount))).toBe(false);
    expect(validateTransferPair(pair, rowsById(out, late))).toBe(false);
    expect(
      validateTransferPair(
        { outRowId: 's:0', inRowId: 'c:0' },
        rowsById(out, into),
      ),
    ).toBe(false);
  });
});

describe('buildReview', () => {
  // Checking: an OFX statement and an overlapping CSV. Card: one CSV and an
  // entered amount owed.
  const jan = file(
    'j',
    [
      row('j', 0, '2026-03-20', 100000, 'Payroll', 'FIT3'),
      row('j', 1, '2026-03-02', -450, 'Blue Bottle', 'FIT1'),
      row('j', 2, '2026-03-05', -20000, 'Payment to Sapphire', 'FIT2'),
    ],
    {
      format: 'ofx',
      statement: statement({ ledgerBalance: 150000, ledgerDate: '2026-03-31' }),
    },
  );
  const recent = file('k', [
    row('k', 0, '2026-03-20', 100000, 'Payroll'),
    row('k', 1, '2026-04-02', -3000, 'Parking'),
  ]);
  const cardFile = file('s', [
    row('s', 0, '2026-03-06', 20000, 'Payment thank you'),
    row('s', 1, '2026-03-15', -2500, 'Coffee shop'),
  ]);

  test('computes each account and the likely transfers', () => {
    const review = buildReview(
      [
        account('checking', [jan, recent]),
        account('card', [cardFile], { type: 'credit', entered: 5000 }),
      ],
      TODAY,
    );

    expect(review.accounts[0]).toEqual({
      draftId: 'checking',
      rows: [jan.rows[1], jan.rows[2], jan.rows[0], recent.rows[1]],
      skipped: [{ row: recent.rows[0], keptFromFileId: 'j' }],
      from: '2026-03-02',
      to: '2026-04-02',
      known: { source: 'ledger', amount: 150000, date: '2026-03-31' },
      // 150000 - (-450 - 20000 + 100000) = 70450
      starting: { amount: 70450, date: '2026-03-02' },
      // 70450 + 79550 - 3000
      ending: 147000,
      block: null,
    });
    expect(review.accounts[1]).toEqual({
      draftId: 'card',
      rows: cardFile.rows,
      skipped: [],
      from: '2026-03-06',
      to: '2026-03-15',
      known: { source: 'entered', amount: -5000, date: '2026-03-15' },
      // -5000 - (20000 - 2500) = -22500, 225.00 owed
      starting: { amount: -22500, date: '2026-03-06' },
      ending: -5000,
      block: null,
    });
    expect(review.candidatePairs).toEqual([
      { outRowId: 'j:2', inRowId: 's:0' },
    ]);
    expect(review.transactionCount).toBe(6);
    expect(review.ready).toBe(true);
  });

  test('blocks an account with an unmapped file or no balance', () => {
    const unmapped = file('u', [], { needsMapping: true });
    const review = buildReview(
      [
        account('checking', [jan, unmapped]),
        account('card', [cardFile], { type: 'credit' }),
      ],
      TODAY,
    );

    expect(review.accounts[0]).toMatchObject({
      block: 'needs-columns',
      known: null,
      starting: null,
      ending: null,
    });
    expect(review.accounts[1]).toMatchObject({
      block: { kind: 'no-balance', asOf: '2026-03-15' },
      known: null,
      starting: null,
      ending: null,
    });
    expect(review.transactionCount).toBe(5);
    expect(review.ready).toBe(false);
  });

  test('creates an account with no files at the entered balance, dated today', () => {
    const review = buildReview(
      [account('cash', [], { type: 'other', entered: 2000 })],
      TODAY,
    );

    expect(review.accounts[0]).toEqual({
      draftId: 'cash',
      rows: [],
      skipped: [],
      from: null,
      to: null,
      known: { source: 'entered', amount: 2000, date: TODAY },
      starting: { amount: 2000, date: TODAY },
      ending: 2000,
      block: null,
    });
    expect(review.candidatePairs).toEqual([]);
    expect(review.ready).toBe(true);
  });
});
