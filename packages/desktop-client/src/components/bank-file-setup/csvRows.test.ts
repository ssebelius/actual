import { defaultImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';

import { chaseCard, chaseChecking } from './csvFixtures';
import { buildCsvMapping, csvToSetupRows, initialCsvMapping } from './csvRows';

const CARD_FILE = 'Chase1234_Activity20260915.CSV';
const CHECKING_FILE = 'Chase5678_Activity_20260915.CSV';

function row(
  fileId: string,
  index: number,
  date: string,
  amount: number,
  payeeName: string,
  notes: string | null = null,
) {
  return {
    id: `${fileId}:${index}`,
    fileId,
    date,
    amount,
    payeeName,
    importedPayee: payeeName,
    notes,
    importedId: null,
  };
}

describe('initialCsvMapping', () => {
  test('Chase card: Description is the payee, Memo the notes', () => {
    const mapping = initialCsvMapping(CARD_FILE, chaseCard);
    expect(mapping.fieldMappings).toEqual({
      date: 'Transaction Date',
      amount: 'Amount',
      payee: 'Description',
      notes: 'Memo',
      inOut: null,
      category: null,
      outflow: null,
      inflow: null,
      balance: null,
    });
    expect(mapping.dateFormat).toBe('mm dd yyyy');
    expect(mapping.settings).toEqual({
      ...defaultImportSettings(CARD_FILE),
      hasHeaderRow: true,
      fieldMappings: mapping.fieldMappings,
      parseDateFormat: 'mm dd yyyy',
      flipAmount: false,
      inOutMode: false,
      outValue: '',
    });
  });

  test('Chase checking: finds the Balance column', () => {
    const mapping = initialCsvMapping(CHECKING_FILE, chaseChecking);
    expect(mapping.fieldMappings).toMatchObject({
      date: 'Posting Date',
      amount: 'Amount',
      payee: 'Description',
      notes: null,
      balance: 'Balance',
    });
  });

  test('headerless rows record hasHeaderRow false', () => {
    const mapping = initialCsvMapping('export.csv', [
      ['09/15/2026', 'Zelle to Jane', '-120.00'],
    ]);
    expect(mapping.settings.hasHeaderRow).toBe(false);
  });
});

describe('csvToSetupRows', () => {
  test('Chase card: integer cents, stable ids, identical rows both kept, no balance', () => {
    const result = csvToSetupRows(
      'card',
      chaseCard,
      initialCsvMapping(CARD_FILE, chaseCard),
    );
    expect(result.errors).toEqual([]);
    expect(result.balance).toBeNull();
    expect(result.rows).toEqual([
      row('card', 0, '2026-09-14', -450, 'STARBUCKS STORE 03512'),
      row('card', 1, '2026-09-14', -450, 'STARBUCKS STORE 03512'),
      row('card', 2, '2026-09-12', -3821, 'SHELL OIL 57444'),
      row('card', 3, '2026-09-10', 50000, 'Payment Thank You-Mobile'),
      row('card', 4, '2026-09-06', -6107, 'TRADER JOE S #552'),
      row(
        'card',
        5,
        '2026-09-03',
        -2399,
        'AMAZON MKTPL*2K4AB1',
        'Birthday gift',
      ),
      row('card', 6, '2026-09-02', 1200, 'AMAZON MKTPL*RETURN'),
    ]);
  });

  test('flip amount reverses every sign', () => {
    const mapping = initialCsvMapping(CARD_FILE, chaseCard);
    const { rows } = csvToSetupRows('card', chaseCard, {
      ...mapping,
      flipAmount: true,
    });
    expect(rows.map(r => r.amount)).toEqual([
      450, 450, 3821, -50000, 6107, 2399, -1200,
    ]);
  });

  test('Chase checking: balance is the closing balance of the latest day', () => {
    const mapping = initialCsvMapping(CHECKING_FILE, chaseChecking);
    const result = csvToSetupRows('chk', chaseChecking, mapping);
    expect(result.errors).toEqual([]);
    expect(result.rows.map(r => [r.date, r.amount])).toEqual([
      ['2026-09-15', -12000],
      ['2026-09-15', 250000],
      ['2026-09-12', -50000],
      ['2026-09-10', -450],
      ['2026-09-01', 5],
    ]);
    expect(result.balance).toEqual({ date: '2026-09-15', amount: 238055 });
  });

  test('the same file oldest first gives the same balance', () => {
    const ascending = [...chaseChecking].reverse();
    const result = csvToSetupRows(
      'chk',
      ascending,
      initialCsvMapping(CHECKING_FILE, ascending),
    );
    expect(result.balance).toEqual({ date: '2026-09-15', amount: 238055 });
  });

  test('headerless rows map by column index', () => {
    const rawRows = [
      ['09/15/2026', 'Zelle to Jane', '-120.00', '2380.55'],
      ['09/10/2026', 'STARBUCKS', '-4.50', '2500.55'],
    ];
    const mapping = buildCsvMapping(
      {
        ...defaultImportSettings('export.csv'),
        hasHeaderRow: false,
        fieldMappings: null,
        parseDateFormat: 'mm dd yyyy',
      },
      {
        fieldMappings: {
          date: '0',
          payee: '1',
          amount: '2',
          notes: null,
          inOut: null,
          category: null,
          outflow: null,
          inflow: null,
          balance: '3',
        },
        dateFormat: 'mm dd yyyy',
        flipAmount: false,
        multiplier: '',
        inOutMode: false,
        outValue: '',
      },
    );
    const result = csvToSetupRows('nohdr', rawRows, mapping);
    expect(result.rows).toEqual([
      row('nohdr', 0, '2026-09-15', -12000, 'Zelle to Jane'),
      row('nohdr', 1, '2026-09-10', -450, 'STARBUCKS'),
    ]);
    expect(result.balance).toEqual({ date: '2026-09-15', amount: 238055 });
  });

  test("an unreadable date skips that row and keeps the others' ids", () => {
    const withPending = chaseCard.map((r, i) =>
      i === 2 ? { ...r, 'Transaction Date': 'Pending' } : r,
    );
    const result = csvToSetupRows(
      'card',
      withPending,
      initialCsvMapping(CARD_FILE, chaseCard),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.rows.map(r => r.id)).toEqual([
      'card:0',
      'card:1',
      'card:3',
      'card:4',
      'card:5',
      'card:6',
    ]);
  });

  test('an unreadable amount is a row error, not a $0 row', () => {
    const withBadAmount = chaseCard.map((r, i) =>
      i === 2 ? { ...r, Amount: 'n/a' } : r,
    );
    const result = csvToSetupRows(
      'card',
      withBadAmount,
      initialCsvMapping(CARD_FILE, chaseCard),
    );
    expect(result.errors).toEqual(['Row 3: n/a is not an amount.']);
    expect(result.rows.map(r => r.id)).toEqual([
      'card:0',
      'card:1',
      'card:3',
      'card:4',
      'card:5',
      'card:6',
    ]);
    expect(result.rows.some(r => r.amount === 0)).toBe(false);
  });

  test('split columns: one readable side is enough, neither is an error', () => {
    const rawRows = [
      ['09/15/2026', 'Zelle to Jane', '120.00', ''],
      ['09/14/2026', 'Payroll', '', '2500.00'],
      ['09/13/2026', 'Blank', '', ''],
    ];
    const mapping = buildCsvMapping(
      {
        ...defaultImportSettings('export.csv'),
        hasHeaderRow: false,
        fieldMappings: null,
        parseDateFormat: 'mm dd yyyy',
      },
      {
        fieldMappings: {
          date: '0',
          payee: '1',
          amount: null,
          notes: null,
          inOut: null,
          category: null,
          outflow: '2',
          inflow: '3',
          balance: null,
        },
        dateFormat: 'mm dd yyyy',
        flipAmount: false,
        multiplier: '',
        inOutMode: false,
        outValue: '',
      },
    );
    const result = csvToSetupRows('split', rawRows, mapping);
    expect(result.rows.map(r => r.amount)).toEqual([-12000, 250000]);
    expect(result.errors).toEqual(['Row 3: (empty) is not an amount.']);
  });

  test('a missing amount column is an error and yields no rows', () => {
    const mapping = initialCsvMapping(CARD_FILE, chaseCard);
    const result = csvToSetupRows('card', chaseCard, {
      ...mapping,
      fieldMappings: { ...mapping.fieldMappings, amount: null },
    });
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual(['Choose the amount column.']);
  });
});
