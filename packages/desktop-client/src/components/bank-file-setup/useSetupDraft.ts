import { useReducer } from 'react';

import {
  dedupeAcrossFiles,
  validateTransferPair,
} from '@actual-app/core/shared/bank-file-setup';
import type {
  SetupAccountDraft,
  SetupAccountType,
  SetupFile,
  SetupRow,
  TransferPair,
} from '@actual-app/core/shared/bank-file-setup';
import * as monthUtils from '@actual-app/core/shared/months';
import type { TFunction } from 'i18next';
import { v4 as uuidv4 } from 'uuid';

import type { CsvMapping, CsvRawRow } from './csvRows';

export type RawCsvRows = CsvRawRow[];

export type SetupState = {
  step: 'choice' | 'accounts';
  accounts: SetupAccountDraft[];
  answers: Record<string, 'confirmed' | 'separate'>; // key `${outRowId}|${inRowId}`
  mappings: Record<string, CsvMapping>; // by file id
  rawCsv: Record<string, RawCsvRows>; // by file id
  csvBytes: Record<string, Uint8Array>; // by file id: kept to re-parse with other CSV options
  fileErrors: Record<string, string[]>; // by file id: rows the parser could not read
  creating: boolean;
  error: string | null; // the server's message, logged; the page shows its own
};

export type SetupAction =
  | { type: 'choose-setup'; draftId: string }
  | { type: 'add-account'; draftId: string }
  | { type: 'remove-account'; draftId: string }
  | {
      type: 'edit-account';
      draftId: string;
      patch: Partial<
        Pick<
          SetupAccountDraft,
          'name' | 'bank' | 'type' | 'offbudget' | 'entered'
        >
      >;
    }
  | {
      type: 'add-file';
      draftId: string;
      file: SetupFile;
      rawCsv?: RawCsvRows;
      csvBytes?: Uint8Array;
      errors?: string[];
    }
  | { type: 'remove-file'; draftId: string; fileId: string }
  | {
      type: 'map-csv';
      fileId: string;
      mapping: CsvMapping;
      rawCsv?: RawCsvRows; // the file re-parsed with the mapping's header and skip options
      rows: SetupRow[];
      balance: { date: string; amount: number } | null;
      errors?: string[]; // rows the mapping could not read
    }
  | {
      type: 'answer-pair';
      pair: TransferPair;
      answer: 'confirmed' | 'separate' | null;
    }
  | { type: 'create-start' }
  | { type: 'create-failed'; error: string };

export const initialSetupState: SetupState = {
  step: 'choice',
  accounts: [],
  answers: {},
  mappings: {},
  rawCsv: {},
  csvBytes: {},
  fileErrors: {},
  creating: false,
  error: null,
};

export function setupReducer(
  state: SetupState,
  action: SetupAction,
): SetupState {
  switch (action.type) {
    case 'choose-setup':
      return {
        ...state,
        step: 'accounts',
        accounts:
          state.accounts.length > 0
            ? state.accounts
            : [emptyAccount(action.draftId)],
      };
    case 'add-account':
      return {
        ...state,
        accounts: [...state.accounts, emptyAccount(action.draftId)],
      };
    case 'remove-account': {
      const removed = state.accounts.find(
        account => account.id === action.draftId,
      );
      if (!removed) {
        return state;
      }
      return withFilesDropped(
        state,
        state.accounts.filter(account => account.id !== action.draftId),
        removed.files.map(file => file.id),
      );
    }
    case 'edit-account':
      return {
        ...state,
        accounts: state.accounts.map(account =>
          account.id === action.draftId
            ? { ...account, ...action.patch }
            : account,
        ),
      };
    case 'add-file': {
      const hasAccount = state.accounts.some(
        account => account.id === action.draftId,
      );
      if (!hasAccount || isAlreadyAdded(state.accounts, action.file.id)) {
        return state;
      }
      const accounts = state.accounts.map(account =>
        account.id === action.draftId
          ? { ...account, files: [...account.files, action.file] }
          : account,
      );
      return {
        ...state,
        accounts,
        rawCsv: action.rawCsv
          ? { ...state.rawCsv, [action.file.id]: action.rawCsv }
          : state.rawCsv,
        csvBytes: action.csvBytes
          ? { ...state.csvBytes, [action.file.id]: action.csvBytes }
          : state.csvBytes,
        fileErrors:
          action.errors && action.errors.length > 0
            ? { ...state.fileErrors, [action.file.id]: action.errors }
            : state.fileErrors,
        answers: pruneAnswers(accounts, state.answers),
      };
    }
    case 'remove-file': {
      const accounts = state.accounts.map(account =>
        account.id === action.draftId
          ? {
              ...account,
              files: account.files.filter(file => file.id !== action.fileId),
            }
          : account,
      );
      return withFilesDropped(state, accounts, [action.fileId]);
    }
    case 'map-csv': {
      if (!hasFile(state.accounts, action.fileId)) {
        return state;
      }
      const accounts = state.accounts.map(account => ({
        ...account,
        files: account.files.map(file =>
          file.id === action.fileId
            ? {
                ...file,
                rows: action.rows,
                csvBalance: action.balance,
                needsMapping: false,
              }
            : file,
        ),
      }));
      return {
        ...state,
        accounts,
        mappings: { ...state.mappings, [action.fileId]: action.mapping },
        rawCsv: action.rawCsv
          ? { ...state.rawCsv, [action.fileId]: action.rawCsv }
          : state.rawCsv,
        fileErrors:
          action.errors && action.errors.length > 0
            ? { ...state.fileErrors, [action.fileId]: action.errors }
            : omitKeys(state.fileErrors, [action.fileId]),
        answers: pruneAnswers(accounts, state.answers),
      };
    }
    case 'answer-pair': {
      const key = pairKey(action.pair);
      const answers = omitKeys(state.answers, [key]);
      return {
        ...state,
        answers:
          action.answer === null
            ? answers
            : { ...answers, [key]: action.answer },
      };
    }
    case 'create-start':
      return { ...state, creating: true, error: null };
    case 'create-failed':
      return { ...state, creating: false, error: action.error };
    default:
      action satisfies never;
      return state;
  }
}

export function useSetupDraft(options: { skipChoice?: boolean } = {}) {
  return useReducer(setupReducer, initialSetupState, initial =>
    options.skipChoice
      ? setupReducer(initial, { type: 'choose-setup', draftId: uuidv4() })
      : initial,
  );
}

export function pairKey(pair: TransferPair): string {
  return `${pair.outRowId}|${pair.inRowId}`;
}

// A file with several statements becomes one SetupFile per statement, with
// ids `${hash}#${index}`; this returns the hash the duplicate check compares
export function fileHash(fileId: string): string {
  return fileId.split('#')[0];
}

export function accountDisplayName(
  account: SetupAccountDraft,
  index: number,
  t: TFunction,
): string {
  const name = account.name.trim();
  return name !== '' ? name : t('Account {{number}}', { number: index + 1 });
}

export function accountTypeLabel(type: SetupAccountType, t: TFunction) {
  switch (type) {
    case 'checking':
      return t('Checking');
    case 'savings':
      return t('Savings');
    case 'credit':
      return t('Credit card');
    case 'other':
      return t('Other');
    default:
      throw new Error(`Unknown account type: ${String(type satisfies never)}`);
  }
}

export function accountsText(count: number, t: TFunction): string {
  return count === 1
    ? t('{{count}} account', { count })
    : t('{{count}} accounts', { count });
}

export function transactionsText(count: number, t: TFunction): string {
  return count === 1
    ? t('{{count}} transaction', { count })
    : t('{{count}} transactions', { count });
}

type DateLocale = Parameters<typeof monthUtils.format>[2];

export function shortDate(date: string, locale: DateLocale): string {
  return monthUtils.format(date, 'MMM d', locale);
}

export function longDate(date: string, locale: DateLocale): string {
  return monthUtils.format(date, 'MMMM d', locale);
}

function emptyAccount(id: string): SetupAccountDraft {
  return {
    id,
    name: '',
    bank: '',
    type: 'checking',
    offbudget: false,
    files: [],
    entered: null,
  };
}

function hasFile(accounts: SetupAccountDraft[], fileId: string): boolean {
  return accounts.some(account =>
    account.files.some(file => file.id === fileId),
  );
}

// The same bytes never reach the draft twice, in any account: a whole file
// conflicts with any statement of it, and a statement with itself. Row ids
// are `${fileId}:${index}`, so this also keeps every row id unique.
function isAlreadyAdded(accounts: SetupAccountDraft[], fileId: string) {
  const hash = fileHash(fileId);
  return accounts.some(account =>
    account.files.some(
      file =>
        file.id === fileId ||
        (fileHash(file.id) === hash && (file.id === hash || fileId === hash)),
    ),
  );
}

function withFilesDropped(
  state: SetupState,
  accounts: SetupAccountDraft[],
  fileIds: string[],
): SetupState {
  return {
    ...state,
    accounts,
    mappings: omitKeys(state.mappings, fileIds),
    rawCsv: omitKeys(state.rawCsv, fileIds),
    csvBytes: omitKeys(state.csvBytes, fileIds),
    fileErrors: omitKeys(state.fileErrors, fileIds),
    answers: pruneAnswers(accounts, state.answers),
  };
}

function omitKeys<T>(
  record: Record<string, T>,
  keys: string[],
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key)),
  );
}

// Review Focus 2: an answer survives only while both of its rows are still
// kept rows and still pair
function pruneAnswers(
  accounts: SetupAccountDraft[],
  answers: SetupState['answers'],
): SetupState['answers'] {
  const rowsById = new Map<string, { draftId: string; row: SetupRow }>();
  for (const account of accounts) {
    for (const row of dedupeAcrossFiles(account.files).kept) {
      rowsById.set(row.id, { draftId: account.id, row });
    }
  }
  return Object.fromEntries(
    Object.entries(answers).filter(([key]) => {
      const [outRowId, inRowId] = key.split('|');
      return validateTransferPair({ outRowId, inRowId }, rowsById);
    }),
  );
}
