import * as nativeFs from 'fs';

import { parseFile, parseFileContents } from './parse-file';
import type { ParsedStatement, ParseFileOptions } from './parse-file';

const FILES = __dirname + '/../../../mocks/files/';

// Every fixture the importer reads today, with the options its tests use.
// The snapshot was recorded before statements were added, so it pins the
// merged `transactions` result and its errors byte for byte.
const EXISTING_FIXTURES: Array<[string, ParseFileOptions]> = [
  ['data.ofx', { importNotes: true }],
  ['data.qfx', { importNotes: true }],
  ['best.data-ever$.QFX', {}],
  ['credit-card.ofx', { importNotes: true }],
  ['data-multi-decimal.ofx', {}],
  [
    'data-payee-memo.ofx',
    { fallbackMissingPayeeToMemo: true, importNotes: true },
  ],
  ['data-payee-memo.ofx', { swapPayeeAndMemo: true, importNotes: true }],
  ['1252.qfx', { importNotes: true }],
  ['8859-1.qfx', { importNotes: true }],
  ['utf-8.qfx', { importNotes: true }],
  ['html-vals.qfx', { importNotes: true }],
  ['data.qif', { importNotes: true }],
  ['big.data.QiF', {}],
  ['qif-category.qif', {}],
  ['data-payee-memo.qif', { swapPayeeAndMemo: true, importNotes: true }],
  ['utf-16le.csv', { hasHeaderRow: true }],
  ['utf-16be.csv', { hasHeaderRow: true }],
  ['utf-8-bom.csv', { hasHeaderRow: true }],
  ['windows-1252.csv', { hasHeaderRow: true, encoding: 'windows-1252' }],
  ['camt/camt.053.xml', { importNotes: true }],
  ['camt/camt.latin1.xml', { importNotes: true }],
  ['camt/camt.053.payee-memo.xml', { swapPayeeAndMemo: true }],
];

describe('merged transactions are unchanged', () => {
  test.each(EXISTING_FIXTURES)('%s %o', async (file, options) => {
    const { errors, transactions } = await parseFile(FILES + file, options);
    expect({ errors, transactions }).toMatchSnapshot();
  });
});

describe('parseFileContents', () => {
  test.each(EXISTING_FIXTURES)(
    'returns what parseFile returns for %s %o',
    async (file, options) => {
      const bytes = new Uint8Array(nativeFs.readFileSync(FILES + file));
      expect(await parseFileContents(file, bytes, options)).toEqual(
        await parseFile(FILES + file, options),
      );
    },
  );

  test('routes .qbo to the OFX parser', async () => {
    const qbo = new Uint8Array(nativeFs.readFileSync(FILES + 'data.qbo'));
    const ofx = await parseFile(FILES + 'data.ofx', { importNotes: true });
    expect(
      await parseFileContents('Chase1234_Activity.QBO', qbo, {
        importNotes: true,
      }),
    ).toEqual(ofx);
    expect(ofx.transactions).toHaveLength(10);
  });

  test('rejects an unknown extension without reading anything', async () => {
    expect(
      await parseFileContents('statement.pdf', new Uint8Array([37, 80])),
    ).toEqual({
      errors: [{ message: 'Invalid file type', internal: '' }],
      transactions: [],
    });
  });

  test('decodes QIF bytes as UTF-8', async () => {
    const bytes = new TextEncoder().encode(
      '!Type:Bank\nD03/05/2026\nPCafé Müller\nT-4.50\n^\n',
    );
    const { errors, transactions } = await parseFileContents(
      'export.qif',
      bytes,
    );
    expect(errors).toEqual([]);
    expect(transactions).toEqual([
      {
        amount: -4.5,
        date: '03/05/2026',
        payee_name: 'Café Müller',
        imported_payee: 'Café Müller',
        category: null,
        notes: null,
      },
    ]);
  });
});

function withoutTransactions(statements: ParsedStatement[] | undefined) {
  return statements?.map(({ transactions, errors, ...rest }) => ({
    ...rest,
    transactionCount: transactions.length,
    errorCount: errors.length,
  }));
}

describe('statements', () => {
  test('a single bank statement carries its account, dates and ledger', async () => {
    const { statements, transactions } = await parseFile(FILES + 'data.ofx', {
      importNotes: true,
    });
    expect(withoutTransactions(statements)).toEqual([
      {
        kind: 'bank',
        org: 'Bank of America',
        fid: '5959',
        bankId: '012345678',
        accountId: '123456789123',
        accountType: 'CHECKING',
        start: '2019-01-19',
        end: '2019-01-24',
        ledgerBalance: 12798.01,
        ledgerDate: '2019-01-24',
        transactionCount: 10,
        errorCount: 0,
      },
    ]);
    expect(statements?.[0].transactions).toEqual(transactions);
  });

  test.each([
    ['data.qfx', 'Bank of America', '5959', 12798.01, '2019-01-24'],
    ['best.data-ever$.QFX', 'Bank of America', '5959', 12798.01, '2019-01-24'],
    ['data.qbo', 'Bank of America', '5959', 12798.01, '2019-01-24'],
    ['data-multi-decimal.ofx', 'Bank of America', '5959', null, null],
    ['data-payee-memo.ofx', null, null, 1000, '2019-01-24'],
  ])(
    '%s: bank statement with org %s and ledger %s',
    async (file, org, fid, ledgerBalance, ledgerDate) => {
      const { statements } = await parseFile(FILES + file);
      expect(withoutTransactions(statements)).toEqual([
        {
          kind: 'bank',
          org,
          fid,
          bankId: '012345678',
          accountId: '123456789123',
          accountType: 'CHECKING',
          start: '2019-01-19',
          end: '2019-01-24',
          ledgerBalance,
          ledgerDate,
          transactionCount: expect.any(Number),
          errorCount: 0,
        },
      ]);
    },
  );

  test.each(['1252.qfx', '8859-1.qfx', 'utf-8.qfx'])(
    '%s: one-day statement with a ledger dated the next day',
    async file => {
      const { statements } = await parseFile(FILES + file);
      expect(withoutTransactions(statements)).toEqual([
        {
          kind: 'bank',
          org: null,
          fid: null,
          bankId: '700012345',
          accountId: '999-12345-0055666-EOP',
          accountType: 'CHECKING',
          start: '2022-10-19',
          end: '2022-10-19',
          ledgerBalance: 9999.99,
          ledgerDate: '2022-10-20',
          transactionCount: 1,
          errorCount: 0,
        },
      ]);
    },
  );

  // The ledger (2023-11-06) is dated after the statement end (2023-10-31)
  test('html-vals.qfx: the ledger date is after the statement end', async () => {
    const { statements } = await parseFile(FILES + 'html-vals.qfx');
    expect(withoutTransactions(statements)).toEqual([
      {
        kind: 'bank',
        org: null,
        fid: null,
        bankId: '000000000',
        accountId: '00000 00-00000',
        accountType: 'CHECKING',
        start: '2019-07-31',
        end: '2023-10-31',
        ledgerBalance: 1111.11,
        ledgerDate: '2023-11-06',
        transactionCount: 2,
        errorCount: 0,
      },
    ]);
  });

  test('credit-card.ofx: a card statement with its ledger', async () => {
    const { statements } = await parseFile(FILES + 'credit-card.ofx');
    expect(withoutTransactions(statements)).toEqual([
      {
        kind: 'credit',
        org: 'Apple Card',
        fid: '12345',
        bankId: null,
        accountId: '7dc6a2fd-2124-457a-a14',
        accountType: null,
        start: '2023-03-01',
        end: '2023-03-31',
        ledgerBalance: -9654.01,
        ledgerDate: '2023-03-31',
        transactionCount: 1,
        errorCount: 0,
      },
    ]);
  });

  test('two-statements.ofx: one statement per account, merged list has both', async () => {
    const { statements, transactions } = await parseFile(
      FILES + 'two-statements.ofx',
    );
    expect(withoutTransactions(statements)).toEqual([
      {
        kind: 'bank',
        org: 'JPMorgan Chase Bank, N.A.',
        fid: '10898',
        bankId: '322271627',
        accountId: '000000001234',
        accountType: 'CHECKING',
        start: '2026-03-01',
        end: '2026-03-25',
        ledgerBalance: 3843.2,
        ledgerDate: '2026-03-25',
        transactionCount: 3,
        errorCount: 0,
      },
      {
        kind: 'bank',
        org: 'JPMorgan Chase Bank, N.A.',
        fid: '10898',
        bankId: '322271627',
        accountId: '000000005678',
        accountType: 'SAVINGS',
        start: '2026-03-01',
        end: '2026-03-25',
        ledgerBalance: 5201.07,
        ledgerDate: '2026-03-25',
        transactionCount: 2,
        errorCount: 0,
      },
    ]);
    expect(statements?.[1].transactions).toEqual([
      {
        amount: 200,
        imported_id: 'SAV-20260310-001',
        date: '2026-03-10',
        payee_name: 'ONLINE TRANSFER FROM CHK ...1234',
        imported_payee: 'ONLINE TRANSFER FROM CHK ...1234',
        notes: null,
      },
      {
        amount: 1.07,
        imported_id: 'SAV-20260324-001',
        date: '2026-03-24',
        payee_name: 'INTEREST PAYMENT',
        imported_payee: 'INTEREST PAYMENT',
        notes: null,
      },
    ]);
    expect(transactions).toEqual([
      ...(statements?.[0].transactions ?? []),
      ...(statements?.[1].transactions ?? []),
    ]);
  });

  test('mixed-bank-card.ofx: both statements, merged list keeps only the card', async () => {
    const { statements, transactions } = await parseFile(
      FILES + 'mixed-bank-card.ofx',
    );
    expect(withoutTransactions(statements)).toEqual([
      {
        kind: 'bank',
        org: 'JPMorgan Chase Bank, N.A.',
        fid: '10898',
        bankId: '322271627',
        accountId: '000000001234',
        accountType: 'CHECKING',
        start: '2026-03-01',
        end: '2026-03-25',
        ledgerBalance: 1843.2,
        ledgerDate: '2026-03-25',
        transactionCount: 2,
        errorCount: 0,
      },
      {
        kind: 'credit',
        org: 'JPMorgan Chase Bank, N.A.',
        fid: '10898',
        bankId: null,
        accountId: '4111111111119876',
        accountType: null,
        start: '2026-03-01',
        end: '2026-03-26',
        ledgerBalance: -1234.56,
        ledgerDate: '2026-03-26',
        transactionCount: 2,
        errorCount: 0,
      },
    ]);
    expect(statements?.[0].transactions.map(t => t.amount)).toEqual([
      -523.1, -61.4,
    ]);
    // Today's precedence: a card message set hides the bank one
    expect(transactions).toEqual(statements?.[1].transactions);
  });

  test('non-OFX formats return no statements', async () => {
    expect((await parseFile(FILES + 'data.qif')).statements).toBeUndefined();
    expect(
      (await parseFile(FILES + 'utf-8-bom.csv', { hasHeaderRow: true }))
        .statements,
    ).toBeUndefined();
    expect(
      (await parseFile(FILES + 'camt/camt.053.xml')).statements,
    ).toBeUndefined();
  });

  test('an invalid amount is reported on its own statement', async () => {
    const mixed = nativeFs.readFileSync(FILES + 'mixed-bank-card.ofx', 'utf8');
    const bytes = new TextEncoder().encode(
      mixed.replace('<TRNAMT>-61.40', '<TRNAMT>N/A'),
    );

    const { errors, transactions, statements } = await parseFileContents(
      'mixed.ofx',
      bytes,
    );

    // The merged list holds only the card rows, so as today it reports nothing
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(statements?.map(statement => statement.errors)).toEqual([
      [
        {
          message: 'Invalid amount format: N/A',
          internal: 'Failed to parse amount: N/A',
        },
      ],
      [],
    ]);
    expect(statements?.[0].transactions[1]).toMatchObject({
      amount: 0,
      payee_name: 'CITY WATER UTILITY',
    });
  });
});
