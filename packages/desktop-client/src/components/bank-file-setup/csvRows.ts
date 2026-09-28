import type { ParseFileResult } from '@actual-app/core/server/transactions/import/parse-file';
import type { SetupRow } from '@actual-app/core/shared/bank-file-setup';
import {
  amountToInteger,
  looselyParseAmount,
} from '@actual-app/core/shared/util';
import { t } from 'i18next';

import { defaultImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';
import type { ImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';
import {
  applyFieldMappings,
  getInitialDateFormat,
  getInitialMappings,
  isDateFormat,
  parseAmountFields,
  parseDate,
} from '#components/modals/ImportTransactionsModal/utils';
import type {
  DateFormat,
  FieldMapping,
} from '#components/modals/ImportTransactionsModal/utils';

/** A parsed CSV row: keyed by header, or by column index without one */
export type CsvRawRow = Record<string, string> | string[];

export type CsvMapping = {
  fieldMappings: FieldMapping;
  dateFormat: string;
  flipAmount: boolean;
  multiplier: string;
  inOutMode: boolean;
  outValue: string;
  /** The full saved-settings set, kept in step with the fields above by buildCsvMapping */
  settings: ImportSettings;
};

type CsvMappingFields = Omit<CsvMapping, 'dateFormat' | 'settings'> & {
  dateFormat: DateFormat;
};

type CsvBalance = { date: string; amount: number };

type CsvSetupRows = {
  rows: SetupRow[];
  balance: CsvBalance | null;
  /** One per row that could not be read; those rows are left out */
  errors: string[];
  /** What the mapping still needs before any row can be read */
  missing: string[];
};

export function csvRowRecord(row: CsvRawRow): Record<string, string> {
  return Array.isArray(row)
    ? Object.fromEntries(row.map((value, index) => [String(index), value]))
    : row;
}

/** The parser's CSV rows as strings, keyed by header or by column index */
export function toCsvRawRows(
  transactions: NonNullable<ParseFileResult['transactions']>,
): CsvRawRow[] {
  return transactions.map(trans =>
    Array.isArray(trans)
      ? trans.map(value => String(value))
      : Object.fromEntries(
          Object.entries(trans).map(([key, value]) => [
            key,
            value == null ? '' : String(value),
          ]),
        ),
  );
}

/** The one place a CsvMapping is built, so `settings` matches the fields */
export function buildCsvMapping(
  base: ImportSettings,
  fields: CsvMappingFields,
): CsvMapping {
  return {
    ...fields,
    settings: {
      ...base,
      fieldMappings: fields.fieldMappings,
      parseDateFormat: fields.dateFormat,
      flipAmount: fields.flipAmount,
      inOutMode: fields.inOutMode,
      outValue: fields.outValue,
    },
  };
}

function columnContaining(
  row: Record<string, string> | undefined,
  word: string,
) {
  if (row === undefined) {
    return null;
  }
  return (
    Object.keys(row).find(name => name.toLowerCase().includes(word)) ?? null
  );
}

/**
 * The dialog's guesses, plus two the setup flow needs: a Balance column,
 * and Description as the payee when no column is named Payee (Chase
 * exports), where the dialog would pick the first leftover column.
 */
export function initialCsvMapping(
  fileName: string,
  rawRows: CsvRawRow[],
): CsvMapping {
  const rows = rawRows.map(csvRowRecord);
  const first = rows[0];
  const guessed = getInitialMappings(rows);
  const description = columnContaining(first, 'description');
  const useDescription =
    description !== null && columnContaining(first, 'payee') === null;

  const fieldMappings: FieldMapping = {
    date: guessed.date ?? null,
    amount: guessed.amount ?? null,
    payee: useDescription ? description : (guessed.payee ?? null),
    notes: useDescription
      ? columnContaining(first, 'memo')
      : (guessed.notes ?? null),
    inOut: null,
    category: null,
    outflow: null,
    inflow: null,
    balance: columnContaining(first, 'balance'),
  };
  const dateFormat = getInitialDateFormat(rows, fieldMappings);

  return buildCsvMapping(
    {
      ...defaultImportSettings(fileName),
      hasHeaderRow: !Array.isArray(rawRows[0]),
      fieldMappings,
      parseDateFormat: dateFormat,
    },
    {
      fieldMappings,
      dateFormat,
      flipAmount: false,
      multiplier: '',
      inOutMode: false,
      outValue: '',
    },
  );
}

export function csvToSetupRows(
  fileId: string,
  rawRows: CsvRawRow[],
  mapping: CsvMapping,
): CsvSetupRows {
  const { fieldMappings, dateFormat } = mapping;
  if (!isDateFormat(dateFormat)) {
    return {
      rows: [],
      balance: null,
      errors: [],
      missing: [t('Choose a date format.')],
    };
  }

  const splitMode = Boolean(fieldMappings.outflow || fieldMappings.inflow);
  const missing: string[] = [];
  if (fieldMappings.date == null) {
    missing.push(t('Choose the date column.'));
  }
  if (fieldMappings.payee == null) {
    missing.push(t('Choose the payee column.'));
  }
  if (!splitMode && fieldMappings.amount == null) {
    missing.push(t('Choose the amount column.'));
  }
  if (missing.length > 0) {
    return { rows: [], balance: null, errors: [], missing };
  }

  const multiplier = parseFloat(mapping.multiplier) || 1;
  const rows: SetupRow[] = [];
  const balances: CsvBalance[] = [];
  const errors: string[] = [];

  rawRows.forEach((raw, index) => {
    const trans = applyFieldMappings(csvRowRecord(raw), fieldMappings);
    const date = parseDate(trans.date ?? null, dateFormat);
    if (date == null) {
      errors.push(
        t('Row {{row}}: {{value}} is not a date in the chosen format.', {
          row: index + 1,
          value: trans.date || t('(empty)'),
        }),
      );
      return;
    }

    // The import dialog would read an unreadable amount as 0; setup
    // previews only a few rows, so it is a row error instead
    const amountValues =
      splitMode && !mapping.inOutMode
        ? [trans.outflow, trans.inflow]
        : [trans.amount];
    if (!amountValues.some(isReadableAmount)) {
      errors.push(
        t('Row {{row}}: {{value}} is not an amount.', {
          row: index + 1,
          value:
            amountValues
              .map(value => (value == null ? '' : String(value)))
              .find(value => value !== '') || t('(empty)'),
        }),
      );
      return;
    }

    const { amount } = parseAmountFields(
      trans,
      splitMode,
      mapping.inOutMode,
      mapping.outValue,
      mapping.flipAmount,
      mapping.multiplier,
    );
    const payeeName =
      typeof trans.payee_name === 'string' ? trans.payee_name.trim() : '';
    const notes =
      mapping.settings.importNotes &&
      typeof trans.notes === 'string' &&
      trans.notes !== ''
        ? trans.notes
        : null;

    rows.push({
      id: `${fileId}:${index}`,
      fileId,
      date,
      amount: amountToInteger(amount),
      payeeName,
      importedPayee: payeeName,
      notes,
      importedId: null,
    });

    // The running balance as the bank prints it: scaled like the amounts,
    // never flipped
    if (fieldMappings.balance != null && typeof trans.balance === 'string') {
      const balance = looselyParseAmount(trans.balance);
      if (balance !== null) {
        balances.push({ date, amount: amountToInteger(balance * multiplier) });
      }
    }
  });

  return { rows, balance: latestBalance(rows, balances), errors, missing: [] };
}

function isReadableAmount(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' && looselyParseAmount(value) !== null;
}

function latestBalance(
  rows: SetupRow[],
  balances: CsvBalance[],
): CsvBalance | null {
  if (balances.length === 0) {
    return null;
  }
  const latest = balances.reduce(
    (max, balance) => (balance.date > max ? balance.date : max),
    balances[0].date,
  );
  const onLatest = balances.filter(balance => balance.date === latest);
  // In a newest-first file the day's closing balance is its first row
  // for that day; oldest first, its last.
  const newestFirst =
    rows.length > 1 && rows[0].date > rows[rows.length - 1].date;
  return newestFirst ? onLatest[0] : onLatest[onLatest.length - 1];
}
