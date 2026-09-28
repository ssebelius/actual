// @ts-strict-ignore
import { parse as csv2json } from 'csv-parse/sync';

import * as fs from '#platform/server/fs';
import { logger } from '#platform/server/log';
import { looselyParseAmount } from '#shared/util';

import { ofx2json, parseOfxAmount } from './ofx2json';
import type { OFXStatement, OFXTransaction } from './ofx2json';
import { qif2json } from './qif2json';
import { xmlCAMT2json } from './xmlcamt2json';

export type StructuredTransaction = {
  amount: number;
  date: string;
  payee_name: string;
  imported_payee: string;
  notes: string;
  category?: string | null;
  imported_id?: string;
};

/**
 * Decode raw CSV file bytes into a string. A user-provided encoding always
 * wins; otherwise the byte order mark selects UTF-16 LE/BE and everything
 * else decodes as UTF-8. Files in other encodings can be selected manually
 * in the import dialog.
 */
function decodeCsvBytes(bytes: Uint8Array, encoding = 'auto'): string {
  if (encoding !== 'auto') {
    // Per the WHATWG encoding spec, the iso-8859-1 label resolves to the
    // windows-1252 decoder; no browser provides a true ISO-8859-1 decoder,
    // and windows-1252 gives better results for legacy CSV content anyway.
    return new TextDecoder(encoding).decode(bytes);
  }

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  return new TextDecoder('utf-8').decode(bytes);
}

// CSV files return raw data that are not guaranteed to be StructuredTransactions
type CsvTransaction = Record<string, string> | string[];

type Transaction = StructuredTransaction | CsvTransaction;

export type ParseError = { message: string; internal: string };

export type ParsedStatement = Omit<OFXStatement, 'transactions'> & {
  transactions: StructuredTransaction[]; // same shape as the merged list
  errors: ParseError[]; // this statement's rows only, e.g. an invalid amount
};

export type ParseFileResult = {
  errors: ParseError[];
  transactions?: Transaction[];
  statements?: ParsedStatement[]; // OFX, QFX and QBO only
};

export type ParseFileOptions = {
  hasHeaderRow?: boolean;
  delimiter?: string;
  fallbackMissingPayeeToMemo?: boolean;
  swapPayeeAndMemo?: boolean;
  skipStartLines?: number;
  skipEndLines?: number;
  importNotes?: boolean;
  encoding?: string;
};

const SUPPORTED_EXTENSIONS = [
  '.qif',
  '.csv',
  '.tsv',
  '.ofx',
  '.qfx',
  '.qbo',
  '.xml',
];

function extensionOf(name: string): string | null {
  return name.match(/\.[^.]*$/)?.[0].toLowerCase() ?? null;
}

function invalidFileType(): ParseFileResult {
  return {
    errors: [{ message: 'Invalid file type', internal: '' }],
    transactions: [],
  };
}

export async function parseFile(
  filepath: string,
  options: ParseFileOptions = {},
): Promise<ParseFileResult> {
  // Check the extension first so an unsupported file is never read
  if (!SUPPORTED_EXTENSIONS.includes(extensionOf(filepath))) {
    return invalidFileType();
  }

  const bytes = await fs.readFile(filepath, 'binary');
  return parseFileContents(filepath, bytes, options);
}

export async function parseFileContents(
  name: string, // used only for its extension
  bytes: Uint8Array,
  options: ParseFileOptions = {},
): Promise<ParseFileResult> {
  switch (extensionOf(name)) {
    case '.qif':
      return parseQIF(bytes, options);
    case '.csv':
    case '.tsv':
      return parseCSV(bytes, options);
    case '.ofx':
    case '.qfx':
    case '.qbo':
      return parseOFX(bytes, options);
    case '.xml':
      return parseCAMT(bytes, options);
    default:
      return invalidFileType();
  }
}

async function parseCSV(
  bytes: Uint8Array,
  options: ParseFileOptions,
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();

  let contents: string;
  try {
    contents = decodeCsvBytes(bytes, options.encoding);
  } catch (err) {
    errors.push({
      message: 'Failed parsing: ' + err.message,
      internal: err.message,
    });
    return { errors, transactions: [] };
  }

  const skipStart = Math.max(0, options.skipStartLines || 0);
  const skipEnd = Math.max(0, options.skipEndLines || 0);

  if (skipStart > 0 || skipEnd > 0) {
    const lines = contents.split(/\r?\n/);

    if (skipStart + skipEnd >= lines.length) {
      errors.push({
        message: 'Cannot skip more lines than exist in the file',
        internal: `Attempted to skip ${skipStart} start + ${skipEnd} end lines from ${lines.length} total lines`,
      });
      return { errors, transactions: [] };
    }

    const startLine = skipStart;
    const endLine = skipEnd > 0 ? lines.length - skipEnd : lines.length;
    contents = lines.slice(startLine, endLine).join('\r\n');
  }

  let data: ReturnType<typeof csv2json>;
  try {
    data = csv2json(contents, {
      columns: options?.hasHeaderRow,
      bom: true,
      delimiter: options?.delimiter || ',',

      quote: '"',
      trim: true,
      relax_column_count: true,
      skip_empty_lines: true,
    });
  } catch (err) {
    errors.push({
      message: 'Failed parsing: ' + err.message,
      internal: err.message,
    });
    return { errors, transactions: [] };
  }

  return { errors, transactions: data };
}

async function parseQIF(
  bytes: Uint8Array,
  options: ParseFileOptions = {},
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();

  let data: ReturnType<typeof qif2json>;
  try {
    data = qif2json(new TextDecoder('utf-8').decode(bytes));
  } catch (err) {
    errors.push({
      message: "Failed parsing: doesn't look like a valid QIF file.",
      internal: err.stack,
    });
    return { errors, transactions: [] };
  }

  const swap = options.swapPayeeAndMemo;

  return {
    errors: [],
    transactions: data.transactions
      .map(trans => {
        const payeeSource = swap ? trans.memo : trans.payee;
        const memoSource = swap ? trans.payee : trans.memo;
        const fallbackUsed = !payeeSource && swap;

        return {
          amount:
            trans.amount != null ? looselyParseAmount(trans.amount) : null,
          date: trans.date,
          payee_name: payeeSource || (fallbackUsed ? memoSource : null),
          imported_payee: payeeSource || (fallbackUsed ? memoSource : null),
          category: trans.subcategory || trans.category || null,
          notes:
            options.importNotes && !fallbackUsed ? memoSource || null : null,
        };
      })
      .filter(trans => trans.date != null && trans.amount != null),
  };
}

async function parseOFX(
  bytes: Uint8Array,
  options: ParseFileOptions,
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();

  let data: Awaited<ReturnType<typeof ofx2json>>;
  try {
    data = await ofx2json(bytes);
  } catch (err) {
    errors.push({
      message: 'Failed importing file',
      internal: err.stack,
    });
    return { errors };
  }

  // Banks don't always implement the OFX standard properly
  // If no payee is available try and fallback to memo
  const useMemoFallback = options.fallbackMissingPayeeToMemo;
  const swap = options.swapPayeeAndMemo;

  function structure(trans: OFXTransaction): StructuredTransaction {
    const payeeSource = swap ? trans.memo : trans.name;
    const memoSource = swap ? trans.name : trans.memo;
    const fallbackUsed = !payeeSource && useMemoFallback;

    return {
      amount: parseOfxAmount(trans.amount) || 0,
      imported_id: trans.fitId,
      date: trans.date,
      payee_name: payeeSource || (fallbackUsed ? memoSource : null),
      imported_payee: payeeSource || (fallbackUsed ? memoSource : null),
      notes: options.importNotes && !fallbackUsed ? memoSource || null : null,
    };
  }

  function invalidAmount(trans: OFXTransaction): ParseError | null {
    return parseOfxAmount(trans.amount) === null
      ? {
          message: `Invalid amount format: ${trans.amount}`,
          internal: `Failed to parse amount: ${trans.amount}`,
        }
      : null;
  }

  // The file-level errors come from the merged list, exactly as before
  const transactions = data.transactions.map(trans => {
    const error = invalidAmount(trans);
    if (error) {
      errors.push(error);
    }
    return structure(trans);
  });

  // Each statement reports its own rows, including rows the merged list
  // leaves out (the bank rows of a file that also has a card statement)
  const statements = data.statements.map(statement => ({
    ...statement,
    transactions: statement.transactions.map(structure),
    errors: statement.transactions.map(invalidAmount).filter(e => e !== null),
  }));

  return { errors, transactions, statements };
}

async function parseCAMT(
  bytes: Uint8Array,
  options: ParseFileOptions = {},
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();

  let data: Awaited<ReturnType<typeof xmlCAMT2json>>;
  try {
    // Pass the raw bytes so xmlCAMT2json can honor the encoding declared in
    // the XML header instead of decoding the file as UTF-8.
    data = await xmlCAMT2json(bytes);
  } catch (err) {
    logger.error(err);
    errors.push({
      message: 'Failed importing file',
      internal: err.stack,
    });
    return { errors };
  }

  const swap = options.swapPayeeAndMemo;

  return {
    errors,
    transactions: data.map(trans => {
      const payeeSource = swap ? trans.notes : trans.payee_name;
      const memoSource = swap ? trans.payee_name : trans.notes;
      const fallbackUsed = !payeeSource && swap;

      return {
        ...trans,
        payee_name: payeeSource || (fallbackUsed ? memoSource : null),
        imported_payee: payeeSource || (fallbackUsed ? memoSource : null),
        notes: options.importNotes && !fallbackUsed ? memoSource || null : null,
      };
    }),
  };
}
