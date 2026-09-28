import {
  defaultImportSettings,
  importSettingsPrefs,
  isCamtFile,
  isOfxFile,
} from './importSettings';
import type { ImportSettings } from './importSettings';

const settings: ImportSettings = {
  fieldMappings: {
    date: 'Date',
    amount: 'Amount',
    payee: 'Payee',
    notes: null,
    inOut: null,
    category: null,
    outflow: null,
    inflow: null,
  },
  parseDateFormat: 'mm dd yyyy',
  delimiter: ';',
  encoding: 'utf-8',
  hasHeaderRow: false,
  skipStartLines: 2,
  skipEndLines: 1,
  inOutMode: true,
  outValue: 'Debit',
  flipAmount: true,
  importNotes: false,
  fallbackMissingPayeeToMemo: false,
  ofxSwapPayeeAndMemo: true,
  qifSwapPayeeAndMemo: true,
  camtSwapPayeeAndMemo: true,
  reimportDeleted: false,
};

// What ImportTransactionsModal.tsx:724-774 wrote before the extraction
const cases: Array<{ fileType: string; expected: Record<string, string> }> = [
  {
    fileType: 'csv',
    expected: {
      'parse-date-acct-1-csv': 'mm dd yyyy',
      'csv-mappings-acct-1':
        '{"date":"Date","amount":"Amount","payee":"Payee","notes":null,"inOut":null,"category":null,"outflow":null,"inflow":null}',
      'csv-delimiter-acct-1': ';',
      'csv-encoding-acct-1': 'utf-8',
      'csv-has-header-acct-1': 'false',
      'csv-skip-start-lines-acct-1': '2',
      'csv-skip-end-lines-acct-1': '1',
      'csv-in-out-mode-acct-1': 'true',
      'csv-out-value-acct-1': 'Debit',
      'flip-amount-acct-1-csv': 'true',
      'import-notes-acct-1-csv': 'false',
      'import-reimport-deleted-acct-1': 'false',
    },
  },
  {
    fileType: 'qif',
    expected: {
      'parse-date-acct-1-qif': 'mm dd yyyy',
      'flip-amount-acct-1-qif': 'true',
      'import-notes-acct-1-qif': 'false',
      'qif-swap-payee-memo-acct-1': 'true',
      'import-reimport-deleted-acct-1': 'false',
    },
  },
  {
    fileType: 'ofx',
    expected: {
      'ofx-fallback-missing-payee-acct-1': 'false',
      'ofx-swap-payee-memo-acct-1': 'true',
      'import-reimport-deleted-acct-1': 'false',
    },
  },
  {
    fileType: 'qfx',
    expected: {
      'ofx-fallback-missing-payee-acct-1': 'false',
      'ofx-swap-payee-memo-acct-1': 'true',
      'import-reimport-deleted-acct-1': 'false',
    },
  },
  {
    fileType: 'xml',
    expected: {
      'camt-swap-payee-memo-acct-1': 'true',
      'import-reimport-deleted-acct-1': 'false',
    },
  },
  {
    fileType: 'qbo',
    expected: {
      'parse-date-acct-1-qbo': 'mm dd yyyy',
      'import-reimport-deleted-acct-1': 'false',
    },
  },
];

describe('importSettingsPrefs', () => {
  test.each(cases)(
    '$fileType writes exactly the keys the import dialog wrote',
    ({ fileType, expected }) => {
      expect(importSettingsPrefs('acct-1', fileType, settings)).toEqual(
        expected,
      );
    },
  );

  test('a mapped balance column is not saved, since the dialog has none', () => {
    const prefs = importSettingsPrefs('acct-1', 'csv', {
      ...settings,
      fieldMappings: {
        date: 'Date',
        amount: 'Amount',
        payee: 'Payee',
        notes: null,
        inOut: null,
        category: null,
        outflow: null,
        inflow: null,
        balance: 'Balance',
      },
    });
    expect(JSON.parse(prefs['csv-mappings-acct-1'])).not.toHaveProperty(
      'balance',
    );
    expect(prefs['csv-mappings-acct-1']).toBe(
      cases[0].expected['csv-mappings-acct-1'],
    );
  });

  test('defaults match the dialog with no saved settings', () => {
    const csvDefaults = {
      delimiter: ',',
      encoding: 'auto',
      hasHeaderRow: true,
      skipStartLines: 0,
      skipEndLines: 0,
      inOutMode: false,
      outValue: '',
      flipAmount: false,
      importNotes: true,
      fallbackMissingPayeeToMemo: true,
      ofxSwapPayeeAndMemo: false,
      qifSwapPayeeAndMemo: false,
      camtSwapPayeeAndMemo: false,
      reimportDeleted: true,
    };
    expect(defaultImportSettings('Chase1234_Activity.CSV')).toEqual(
      csvDefaults,
    );
    expect(defaultImportSettings('export.tsv')).toEqual({
      ...csvDefaults,
      delimiter: '\t',
    });
  });

  test('file type predicates', () => {
    expect(['ofx', 'qfx', 'qbo', 'csv'].map(isOfxFile)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(['xml', 'ofx'].map(isCamtFile)).toEqual([true, false]);
  });
});
