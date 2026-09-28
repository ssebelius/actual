import {
  filterByStartDate,
  getInitialDateFormat,
  getInitialMappings,
  parseCategoryFields,
  parseDate,
} from './utils';
import type { ImportTransaction } from './utils';

describe('Import transactions', () => {
  describe('date parsing', () => {
    const invalidInputs: Array<{
      str: Parameters<typeof parseDate>[0];
      order: Parameters<typeof parseDate>[1];
    }> = [
      { str: '', order: 'yyyy mm dd' },
      { str: null, order: 'yyyy mm dd' },
      { str: 42, order: 'yyyy mm dd' },
      { str: {}, order: 'yyyy mm dd' },
      { str: [], order: 'yyyy mm dd' },
      { str: 'Decimal 24 2020', order: 'mm dd yyyy' },
      { str: '24 aDec 2020', order: 'dd mm yyyy' },
      { str: 'invalid', order: 'yyyy mm dd' },
      { str: '12 24 20', order: 'mm dd yyyy' },
      { str: '20 12 24', order: 'yyyy mm dd' },
      { str: '2020 12 24', order: 'yy mm dd' },
      { str: '12 24 2020', order: 'mm dd yy' },
      { str: '12 00 2020', order: 'mm dd yyyy' },
      { str: '12 32 2020', order: 'mm dd yyyy' },
      { str: '13 24 2020', order: 'mm dd yyyy' },
      { str: '00 24 2020', order: 'mm dd yyyy' },
      { str: '02 30 2020', order: 'mm dd yyyy' },
      { str: '04 31 2020', order: 'mm dd yyyy' },
      { str: '04 31 2020', order: 'mm dd yyyy' },
      { str: '06 31 2020', order: 'mm dd yyyy' },
      { str: '09 31 2020', order: 'mm dd yyyy' },
      { str: '11 31 2020', order: 'mm dd yyyy' },
      { str: '2046 31 2020', order: 'mm dd yyyy' },
      { str: '2011 31 2020', order: 'mm dd yy' },
      { str: '2020', order: 'mm dd yy' },
    ];

    it.each(invalidInputs)(
      'should not parse string `$str` with order `$order`',
      ({ str, order }) => {
        expect(parseDate(str, order)).toBe(null);
      },
    );

    const validInputs: Array<{
      order: Parameters<typeof parseDate>[1];
      cases: [Parameters<typeof parseDate>[0], ReturnType<typeof parseDate>][];
    }> = [
      {
        order: 'yyyy mm dd',
        cases: [
          ['2020 Dec 24', '2020-12-24'],
          ['2020 Dec. 24', '2020-12-24'],
          ['2020 December 24', '2020-12-24'],
          ['20201224', '2020-12-24'],
          ['2020 12 24', '2020-12-24'],
          ['2020-1-2', '2020-01-02'],
          ['2020-12-24', '2020-12-24'],
          ['2020/12/24', '2020-12-24'],
          [' 2020 / 12 / 24', '2020-12-24'],
          ['2020/12/24 ', '2020-12-24'],
          ['2020 12-24 ', '2020-12-24'],
          ['2023-01-19T02:36:52', '2023-01-19'],
        ],
      },
      {
        order: 'yy mm dd',
        cases: [
          ['20 Dec 24', '2020-12-24'],
          ['20 Dec. 24', '2020-12-24'],
          ['20 December 24', '2020-12-24'],
          ['201224', '2020-12-24'],
          ['20 12 24', '2020-12-24'],
          ['20-12-24', '2020-12-24'],
          ['20/12/24', '2020-12-24'],
          ['20/12/24', '2020-12-24'],
          ['20/12/24 ', '2020-12-24'],
          ['20/1/2 ', '2020-01-02'],
          ['20 12-24 ', '2020-12-24'],
        ],
      },
      {
        order: 'mm dd yyyy',
        cases: [
          ['Dec 24, 2020', '2020-12-24'],
          ['Dec. 24, 2020', '2020-12-24'],
          ['December 24, 2020', '2020-12-24'],
          ['Sept 6, 2026', '2026-09-06'],
          ['12242020', '2020-12-24'],
          ['1 24 2020', '2020-01-24'],
          ['01 24 2020', '2020-01-24'],
          ['12 24 2020 ', '2020-12-24'],
          ['12-24-2020', '2020-12-24'],
          ['12/24/2020', '2020-12-24'],
          [' 12/24/2020', '2020-12-24'],
          ['12/24/2020', '2020-12-24'],
          ['12 24-2020', '2020-12-24'],
        ],
      },
      {
        order: 'mm dd yy',
        cases: [
          ['Dec 24, 20', '2020-12-24'],
          ['Dec. 24, 20', '2020-12-24'],
          ['December 24, 20', '2020-12-24'],
          ['122420', '2020-12-24'],
          ['12 24 20 ', '2020-12-24'],
          ['12-24-20', '2020-12-24'],
          ['1-24-20', '2020-01-24'],
          ['01-24-20', '2020-01-24'],
          ['12/24/20', '2020-12-24'],
          [' 12/24/20', '2020-12-24'],
          ['12/24/20', '2020-12-24'],
          ['1/24/20', '2020-01-24'],
          ['12 24-20', '2020-12-24'],
        ],
      },
      {
        order: 'dd mm yyyy',
        cases: [
          ['24 Dec 2020', '2020-12-24'],
          ['24 Dec. 2020', '2020-12-24'],
          ['24 December 2020', '2020-12-24'],
          ['6 Sept 2026', '2026-09-06'],
          ['24122020', '2020-12-24'],
          ['24 12 2020 ', '2020-12-24'],
          ['2 12 2020', '2020-12-02'],
          ['02 12 2020 ', '2020-12-02'],
          ['24-12-2020', '2020-12-24'],
          ['02-12-2020', '2020-12-02'],
          ['24/12/2020', '2020-12-24'],
          [' 24/12/2020', '2020-12-24'],
          ['24/12/2020 ', '2020-12-24'],
          ['2/12/2020 ', '2020-12-02'],
          ['24-12 2020', '2020-12-24'],
        ],
      },
      {
        order: 'dd mm yy',
        cases: [
          ['24 Dec 20', '2020-12-24'],
          ['24 Dec. 20', '2020-12-24'],
          ['24 December 20', '2020-12-24'],
          ['06 Sept 26', '2026-09-06'],
          ['06 Sept. 26', '2026-09-06'],
          ['241220', '2020-12-24'],
          ['2412 20 ', '2020-12-24'],
          ['24-12-20', '2020-12-24'],
          ['2-12-20', '2020-12-02'],
          ['02-12-20', '2020-12-02'],
          ['24/12/20', '2020-12-24'],
          [' 24/12/20', '2020-12-24'],
          ['24/12/20 ', '2020-12-24'],
          ['2/12/20', '2020-12-02'],
          ['02/12/20', '2020-12-02'],
          ['24 12-20 ', '2020-12-24'],
        ],
      },
    ];

    describe.each(validInputs)(
      'should parse with order `$order`',
      ({ order, cases }) => {
        it.each(cases)('given input %j expects output %j', (input, output) => {
          const parsed = parseDate(input, order);

          expect(typeof parsed).toBe('string');
          expect(parsed).toBe(output);
        });
      },
    );
  });

  describe('filterByStartDate', () => {
    function makeTrans(
      overrides: Partial<ImportTransaction>,
    ): ImportTransaction {
      return {
        trx_id: '0',
        existing: false,
        ignored: false,
        selected: true,
        selected_merge: false,
        amount: 0,
        inflow: 0,
        outflow: 0,
        inOut: '',
        ...overrides,
      };
    }

    it('returns all transactions when startDate is empty', () => {
      const transactions = [
        makeTrans({ trx_id: '0', date: '2024-01-15' }),
        makeTrans({ trx_id: '1', date: '2024-02-20' }),
      ];
      const result = filterByStartDate(transactions, '', true, null, null);
      expect(result).toHaveLength(2);
    });

    it('filters out transactions before startDate for pre-parsed dates', () => {
      const transactions = [
        makeTrans({ trx_id: '0', date: '2024-01-15' }),
        makeTrans({ trx_id: '1', date: '2024-02-20' }),
        makeTrans({ trx_id: '2', date: '2024-03-01' }),
      ];
      const result = filterByStartDate(
        transactions,
        '2024-02-01',
        true,
        null,
        null,
      );
      expect(result).toHaveLength(2);
      expect(result.map(t => t.trx_id)).toEqual(['1', '2']);
    });

    it('includes transactions on the exact startDate', () => {
      const transactions = [makeTrans({ trx_id: '0', date: '2024-02-01' })];
      const result = filterByStartDate(
        transactions,
        '2024-02-01',
        true,
        null,
        null,
      );
      expect(result).toHaveLength(1);
    });

    it('keeps transactions with unparseable dates', () => {
      const transactions = [makeTrans({ trx_id: '0', date: 'invalid' })];
      const result = filterByStartDate(
        transactions,
        '2024-02-01',
        false,
        null,
        'mm dd yyyy',
      );
      expect(result).toHaveLength(1);
    });

    it('works with CSV dates requiring date format parsing', () => {
      const transactions = [
        makeTrans({ trx_id: '0', date: '01/15/2024' }),
        makeTrans({ trx_id: '1', date: '03/01/2024' }),
      ];
      const result = filterByStartDate(
        transactions,
        '2024-02-01',
        false,
        null,
        'mm dd yyyy',
      );
      expect(result).toHaveLength(1);
      expect(result[0].trx_id).toBe('1');
    });

    it('works with field mappings for CSV', () => {
      const transactions = [
        makeTrans({
          trx_id: '0',
          Date: '01/15/2024',
        } satisfies Partial<ImportTransaction>),
        makeTrans({
          trx_id: '1',
          Date: '03/01/2024',
        } satisfies Partial<ImportTransaction>),
      ];
      const fieldMappings = {
        date: 'Date',
        amount: null,
        payee: null,
        notes: null,
        inOut: null,
        category: null,
        outflow: null,
        inflow: null,
      };
      const result = filterByStartDate(
        transactions,
        '2024-02-01',
        false,
        fieldMappings,
        'mm dd yyyy',
      );
      expect(result).toHaveLength(1);
      expect(result[0].trx_id).toBe('1');
    });
  });

  describe('parseCategoryFields', () => {
    const categories = [
      { id: 'cat-income', name: 'Income' },
      { id: 'cat-deposits', name: 'Deposits' },
    ];

    it('returns the category id when CSV category text matches a category name', () => {
      expect(parseCategoryFields({ category: 'Deposits' }, categories)).toBe(
        'cat-deposits',
      );
    });

    it('returns null for unresolved CSV category text', () => {
      expect(
        parseCategoryFields({ category: 'Missing category' }, categories),
      ).toBeNull();
    });
  });
});

describe('column guessing', () => {
  const chaseCardRow = {
    'Transaction Date': '09/14/2026',
    'Post Date': '09/15/2026',
    Description: 'STARBUCKS STORE 03512',
    Category: 'Food & Drink',
    Type: 'Sale',
    Amount: '-4.50',
    Memo: '',
  };

  test('getInitialMappings guesses exactly as the dialog did', () => {
    expect(getInitialMappings([])).toEqual({});
    expect(getInitialMappings([chaseCardRow])).toEqual({
      date: 'Transaction Date',
      amount: 'Amount',
      payee: 'Post Date',
      notes: 'Description',
      inOut: 'Category',
      category: 'Category',
    });
  });

  test("getInitialMappings ignores the dialog's preview fields", () => {
    expect(
      getInitialMappings([
        {
          trx_id: '0',
          selected: true,
          Date: '2026-09-14',
          Payee: 'Starbucks',
          Amount: '-4.50',
          Notes: 'coffee',
        },
      ]),
    ).toEqual({
      date: 'Date',
      amount: 'Amount',
      payee: 'Payee',
      notes: 'Notes',
      inOut: null,
      category: null,
    });
  });

  test('getInitialMappings reads headerless rows by column index', () => {
    // No column name matches, so date and amount are found by value;
    // payee is the first column left, and nothing is left for notes.
    expect(
      getInitialMappings([['09/15/2026', 'Zelle to Jane', '-120.00']]),
    ).toEqual({
      date: '0',
      amount: '2',
      payee: '1',
      notes: null,
      inOut: null,
      category: null,
    });
  });

  test('getInitialDateFormat picks the first format that parses', () => {
    expect(getInitialDateFormat([], { date: 'Date' })).toBe('yyyy mm dd');
    expect(getInitialDateFormat([chaseCardRow], { date: null })).toBe(
      'yyyy mm dd',
    );
    expect(
      getInitialDateFormat([chaseCardRow], { date: 'Transaction Date' }),
    ).toBe('mm dd yyyy');
    expect(
      getInitialDateFormat([{ Date: '2026-09-14' }], { date: 'Date' }),
    ).toBe('yyyy mm dd');
    expect(getInitialDateFormat([{ Date: 'soon' }], { date: 'Date' })).toBe(
      'mm dd yyyy',
    );
  });
});
