import type {
  SetupAccountDraft,
  SetupFile,
  SetupRow,
} from '@actual-app/core/shared/bank-file-setup';
import { renderHook } from '@testing-library/react';

import { initialCsvMapping } from './csvRows';
import {
  initialSetupState,
  pairKey,
  setupReducer,
  useSetupDraft,
} from './useSetupDraft';
import type { SetupAction, SetupState } from './useSetupDraft';

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
    importedId: null,
  };
}

// Checking pays the card 523.10 on Aug 3
const checkingFile: SetupFile = {
  id: 'chk',
  name: 'checking.qfx',
  format: 'qfx',
  rows: [
    row('chk', 0, '2026-08-03', -52310, 'Payment to Chase card'),
    row('chk', 1, '2026-09-01', 100000, 'Payroll'),
  ],
  statement: {
    org: 'Chase',
    accountId: '000123454821',
    accountType: 'CHECKING',
    start: '2026-08-01',
    end: '2026-09-26',
    ledgerBalance: 241055,
    ledgerDate: '2026-09-26',
  },
  csvBalance: null,
  needsMapping: false,
};

const cardRaw = [
  {
    'Transaction Date': '08/04/2026',
    Description: 'Payment Thank You',
    Amount: '523.10',
  },
  { 'Transaction Date': '09/10/2026', Description: 'Coffee', Amount: '-40.00' },
];

const cardFile: SetupFile = {
  id: 'card',
  name: 'activity.csv',
  format: 'csv',
  rows: [],
  statement: null,
  csvBalance: null,
  needsMapping: true,
};

// The card receives it on Aug 4
const cardRows = [
  row('card', 0, '2026-08-04', 52310, 'Payment Thank You'),
  row('card', 1, '2026-09-10', -4000, 'Coffee'),
];

const mapping = initialCsvMapping('activity.csv', cardRaw);

const pair = { outRowId: 'chk:0', inRowId: 'card:0' };

function run(state: SetupState, ...actions: SetupAction[]): SetupState {
  return actions.reduce(setupReducer, state);
}

function account(state: SetupState, id: string): SetupAccountDraft {
  const found = state.accounts.find(candidate => candidate.id === id);
  if (!found) {
    throw new Error(`No account ${id}`);
  }
  return found;
}

function withConfirmedPair(): SetupState {
  return run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'checking' },
    { type: 'add-file', draftId: 'checking', file: checkingFile },
    { type: 'add-account', draftId: 'card' },
    { type: 'add-file', draftId: 'card', file: cardFile, rawCsv: cardRaw },
    { type: 'map-csv', fileId: 'card', mapping, rows: cardRows, balance: null },
    { type: 'answer-pair', pair, answer: 'confirmed' },
  );
}

test('choose-setup opens the accounts step with one empty account', () => {
  const state = setupReducer(initialSetupState, {
    type: 'choose-setup',
    draftId: 'first',
  });
  expect(state.step).toBe('accounts');
  expect(state.accounts).toEqual([
    {
      id: 'first',
      name: '',
      bank: '',
      type: 'checking',
      offbudget: false,
      files: [],
      entered: null,
    },
  ]);
});

test('choose-setup keeps accounts that already exist', () => {
  const state = run(
    initialSetupState,
    { type: 'add-account', draftId: 'a' },
    { type: 'choose-setup', draftId: 'b' },
  );
  expect(state.accounts.map(a => a.id)).toEqual(['a']);
});

test('adds, edits and removes accounts', () => {
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'a' },
    { type: 'add-account', draftId: 'b' },
    {
      type: 'edit-account',
      draftId: 'b',
      patch: { name: 'Sapphire', type: 'credit', entered: 112648 },
    },
    { type: 'remove-account', draftId: 'a' },
  );
  expect(state.accounts).toEqual([
    {
      id: 'b',
      name: 'Sapphire',
      bank: '',
      type: 'credit',
      offbudget: false,
      files: [],
      entered: 112648,
    },
  ]);
});

test('add-file keeps the raw CSV rows and refuses a file already added anywhere', () => {
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'card' },
    { type: 'add-account', draftId: 'other' },
    { type: 'add-file', draftId: 'card', file: cardFile, rawCsv: cardRaw },
  );
  expect(account(state, 'card').files).toEqual([cardFile]);
  expect(state.rawCsv).toEqual({ card: cardRaw });

  const again = setupReducer(state, {
    type: 'add-file',
    draftId: 'other',
    file: cardFile,
  });
  expect(again).toBe(state);
});

test("a file's statements can go to two accounts, but the same bytes never twice", () => {
  function fileWithId(id: string): SetupFile {
    return {
      ...checkingFile,
      id,
      rows: [row(id, 0, '2026-08-03', -52310, 'Payment to Chase card')],
    };
  }
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'a' },
    { type: 'add-account', draftId: 'b' },
    { type: 'add-file', draftId: 'a', file: fileWithId('multi#0') },
    { type: 'add-file', draftId: 'b', file: fileWithId('multi#1') },
  );
  expect(account(state, 'a').files.map(file => file.id)).toEqual(['multi#0']);
  expect(account(state, 'b').files.map(file => file.id)).toEqual(['multi#1']);

  // The same bytes as a whole file, or one of its statements again
  expect(
    setupReducer(state, {
      type: 'add-file',
      draftId: 'b',
      file: fileWithId('multi'),
    }),
  ).toBe(state);
  expect(
    setupReducer(state, {
      type: 'add-file',
      draftId: 'a',
      file: fileWithId('multi#1'),
    }),
  ).toBe(state);
});

test("add-file keeps a statement's row errors until the file is removed", () => {
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'checking' },
    {
      type: 'add-file',
      draftId: 'checking',
      file: checkingFile,
      errors: ['Invalid amount format: N/A'],
    },
  );
  expect(state.fileErrors).toEqual({ chk: ['Invalid amount format: N/A'] });

  const removed = setupReducer(state, {
    type: 'remove-file',
    draftId: 'checking',
    fileId: 'chk',
  });
  expect(removed.fileErrors).toEqual({});
});

test('map-csv fills the rows and balance and keeps the mapping', () => {
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'card' },
    { type: 'add-file', draftId: 'card', file: cardFile, rawCsv: cardRaw },
    {
      type: 'map-csv',
      fileId: 'card',
      mapping,
      rows: cardRows,
      balance: { date: '2026-09-10', amount: -112648 },
    },
  );
  expect(account(state, 'card').files).toEqual([
    {
      ...cardFile,
      rows: cardRows,
      csvBalance: { date: '2026-09-10', amount: -112648 },
      needsMapping: false,
    },
  ]);
  expect(state.mappings).toEqual({ card: mapping });
});

test("map-csv keeps the rows that parsed and records the mapping's row errors", () => {
  const withErrors = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'card' },
    { type: 'add-file', draftId: 'card', file: cardFile, rawCsv: cardRaw },
    {
      type: 'map-csv',
      fileId: 'card',
      mapping,
      rows: cardRows.slice(0, 1),
      balance: null,
      errors: ['Row 2: 13/40/2026 is not a date in the chosen format.'],
    },
  );
  expect(account(withErrors, 'card').files[0].rows).toEqual(
    cardRows.slice(0, 1),
  );
  expect(withErrors.fileErrors).toEqual({
    card: ['Row 2: 13/40/2026 is not a date in the chosen format.'],
  });

  // A later mapping that reads every row clears them
  const clean = setupReducer(withErrors, {
    type: 'map-csv',
    fileId: 'card',
    mapping,
    rows: cardRows,
    balance: null,
    errors: [],
  });
  expect(clean.fileErrors).toEqual({});
});

test('map-csv without errors records none', () => {
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'card' },
    { type: 'add-file', draftId: 'card', file: cardFile, rawCsv: cardRaw },
    { type: 'map-csv', fileId: 'card', mapping, rows: cardRows, balance: null },
  );
  expect(state.fileErrors).toEqual({});
});

test('map-csv replaces the raw rows with the ones the mapping re-parsed', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const reparsed = [['09/10/2026', 'Coffee', '-4.50']];
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'card' },
    {
      type: 'add-file',
      draftId: 'card',
      file: cardFile,
      rawCsv: cardRaw,
      csvBytes: bytes,
    },
    {
      type: 'map-csv',
      fileId: 'card',
      mapping,
      rawCsv: reparsed,
      rows: cardRows,
      balance: null,
    },
  );
  expect(state.rawCsv).toEqual({ card: reparsed });
  expect(state.csvBytes).toEqual({ card: bytes });
});

test('remove-file drops the file with its mapping, raw rows and bytes', () => {
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'card' },
    {
      type: 'add-file',
      draftId: 'card',
      file: cardFile,
      rawCsv: cardRaw,
      csvBytes: new Uint8Array([1, 2, 3]),
    },
    { type: 'map-csv', fileId: 'card', mapping, rows: cardRows, balance: null },
    { type: 'remove-file', draftId: 'card', fileId: 'card' },
  );
  expect(account(state, 'card').files).toEqual([]);
  expect(state.mappings).toEqual({});
  expect(state.rawCsv).toEqual({});
  expect(state.csvBytes).toEqual({});
  expect(state.fileErrors).toEqual({});
});

test('answer-pair records an answer and clears it with null', () => {
  const state = withConfirmedPair();
  expect(pairKey(pair)).toBe('chk:0|card:0');
  expect(state.answers).toEqual({ 'chk:0|card:0': 'confirmed' });

  const cleared = setupReducer(state, {
    type: 'answer-pair',
    pair,
    answer: null,
  });
  expect(cleared.answers).toEqual({});
});

test('create-start and create-failed keep the draft', () => {
  const started = setupReducer(withConfirmedPair(), { type: 'create-start' });
  expect(started.creating).toBe(true);
  expect(started.error).toBeNull();

  const failed = setupReducer(started, {
    type: 'create-failed',
    error: 'Disk full',
  });
  expect(failed.creating).toBe(false);
  expect(failed.error).toBe('Disk full');
  expect(failed.accounts).toBe(started.accounts);
  expect(failed.answers).toEqual({ 'chk:0|card:0': 'confirmed' });
});

describe('stale transfer answers (Review Focus 2)', () => {
  test('removing the card file drops the confirmed pair', () => {
    const state = setupReducer(withConfirmedPair(), {
      type: 'remove-file',
      draftId: 'card',
      fileId: 'card',
    });
    expect(state.answers).toEqual({});
  });

  test('removing the checking account drops the confirmed pair', () => {
    const state = setupReducer(withConfirmedPair(), {
      type: 'remove-account',
      draftId: 'checking',
    });
    expect(state.answers).toEqual({});
  });

  test('remapping the CSV so the amount changes drops the confirmed pair', () => {
    const state = setupReducer(withConfirmedPair(), {
      type: 'map-csv',
      fileId: 'card',
      mapping: { ...mapping, multiplier: '0.1' },
      rows: [
        row('card', 0, '2026-08-04', 5231, 'Payment Thank You'),
        row('card', 1, '2026-09-10', -400, 'Coffee'),
      ],
      balance: null,
    });
    expect(state.answers).toEqual({});
  });

  test('remapping to the same amounts keeps the confirmed pair', () => {
    const state = setupReducer(withConfirmedPair(), {
      type: 'map-csv',
      fileId: 'card',
      mapping,
      rows: cardRows,
      balance: null,
    });
    expect(state.answers).toEqual({ 'chk:0|card:0': 'confirmed' });
  });

  test('editing an account keeps the confirmed pair', () => {
    const state = setupReducer(withConfirmedPair(), {
      type: 'edit-account',
      draftId: 'card',
      patch: { name: 'Chase Sapphire', entered: 112648 },
    });
    expect(state.answers).toEqual({ 'chk:0|card:0': 'confirmed' });
  });
});

describe('useSetupDraft', () => {
  it('starts on the choice by default', () => {
    const { result } = renderHook(() => useSetupDraft());
    expect(result.current[0].step).toBe('choice');
    expect(result.current[0].accounts).toHaveLength(0);
  });

  it('starts on the accounts step with one empty account when skipChoice is set', () => {
    const { result } = renderHook(() => useSetupDraft({ skipChoice: true }));
    expect(result.current[0].step).toBe('accounts');
    expect(result.current[0].accounts).toHaveLength(1);
    expect(result.current[0].accounts[0].files).toEqual([]);
  });
});
