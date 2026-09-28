import type { DateFormat, FieldMapping } from './utils';

/** Everything the import dialog saves per account, as it holds it in state */
export type ImportSettings = {
  fieldMappings: FieldMapping | null;
  parseDateFormat: DateFormat;
  delimiter: string;
  encoding: string;
  hasHeaderRow: boolean;
  skipStartLines: number;
  skipEndLines: number;
  inOutMode: boolean;
  outValue: string;
  flipAmount: boolean;
  importNotes: boolean;
  fallbackMissingPayeeToMemo: boolean;
  ofxSwapPayeeAndMemo: boolean;
  qifSwapPayeeAndMemo: boolean;
  camtSwapPayeeAndMemo: boolean;
  reimportDeleted: boolean;
};

export function isOfxFile(fileType: string) {
  return fileType === 'ofx' || fileType === 'qfx';
}

export function isCamtFile(fileType: string) {
  return fileType === 'xml';
}

/**
 * The synced prefs the import dialog writes after an import, keyed by
 * account and file type. The dialog and the bank file setup flow both
 * write through this, so the key set cannot diverge.
 */
export function importSettingsPrefs(
  accountId: string,
  fileType: string,
  settings: ImportSettings,
): Record<string, string> {
  const prefs: Record<string, string> = {};

  if (!isOfxFile(fileType) && !isCamtFile(fileType)) {
    prefs[`parse-date-${accountId}-${fileType}`] = settings.parseDateFormat;
  }

  if (isOfxFile(fileType)) {
    prefs[`ofx-fallback-missing-payee-${accountId}`] = String(
      settings.fallbackMissingPayeeToMemo,
    );
    prefs[`ofx-swap-payee-memo-${accountId}`] = String(
      settings.ofxSwapPayeeAndMemo,
    );
  }

  if (fileType === 'csv') {
    prefs[`csv-mappings-${accountId}`] = JSON.stringify(
      withoutBalance(settings.fieldMappings),
    );
    prefs[`csv-delimiter-${accountId}`] = settings.delimiter;
    prefs[`csv-encoding-${accountId}`] = settings.encoding;
    prefs[`csv-has-header-${accountId}`] = String(settings.hasHeaderRow);
    prefs[`csv-skip-start-lines-${accountId}`] = String(
      settings.skipStartLines,
    );
    prefs[`csv-skip-end-lines-${accountId}`] = String(settings.skipEndLines);
    prefs[`csv-in-out-mode-${accountId}`] = String(settings.inOutMode);
    prefs[`csv-out-value-${accountId}`] = String(settings.outValue);
  }

  if (fileType === 'csv' || fileType === 'qif') {
    prefs[`flip-amount-${accountId}-${fileType}`] = String(settings.flipAmount);
    prefs[`import-notes-${accountId}-${fileType}`] = String(
      settings.importNotes,
    );
  }

  if (fileType === 'qif') {
    prefs[`qif-swap-payee-memo-${accountId}`] = String(
      settings.qifSwapPayeeAndMemo,
    );
  }

  if (isCamtFile(fileType)) {
    prefs[`camt-swap-payee-memo-${accountId}`] = String(
      settings.camtSwapPayeeAndMemo,
    );
  }

  prefs[`import-reimport-deleted-${accountId}`] = String(
    settings.reimportDeleted,
  );

  return prefs;
}

/**
 * The dialog has no Balance column: a saved `balance` would be copied onto
 * every imported transaction, which the server rejects.
 */
function withoutBalance(fieldMappings: FieldMapping | null) {
  if (fieldMappings === null) {
    return null;
  }
  const { balance: _balance, ...rest } = fieldMappings;
  return rest;
}

/**
 * The dialog's starting values when an account has no saved settings
 * (its reads at ImportTransactionsModal.tsx:242-277 with empty prefs).
 */
export function defaultImportSettings(
  fileName: string,
): Omit<ImportSettings, 'fieldMappings' | 'parseDateFormat'> {
  return {
    delimiter: fileName.toLowerCase().endsWith('.tsv') ? '\t' : ',',
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
}
