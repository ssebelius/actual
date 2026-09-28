import * as monthUtils from './months';

export type SetupAccountType = 'checking' | 'savings' | 'credit' | 'other';

export type SetupRow = {
  id: string; // `${fileId}:${index}`, stable for the life of the file
  fileId: string;
  date: string; // YYYY-MM-DD
  amount: number; // integer cents, negative = money out
  payeeName: string;
  importedPayee: string;
  notes: string | null;
  importedId: string | null;
};

export type SetupStatement = {
  org: string | null;
  accountId: string | null;
  accountType: string | null;
  start: string | null;
  end: string | null;
  ledgerBalance: number | null; // integer cents
  ledgerDate: string | null;
};

export type SetupFile = {
  id: string; // SHA-256 hex of the file's bytes
  name: string;
  format: 'ofx' | 'qfx' | 'qbo' | 'qif' | 'csv' | 'tsv' | 'xml';
  rows: SetupRow[]; // empty until a CSV is mapped
  statement: SetupStatement | null;
  csvBalance: { date: string; amount: number } | null; // last row's mapped Balance column
  needsMapping: boolean;
};

export type SetupAccountDraft = {
  id: string; // client id, not the account id Create assigns
  name: string;
  bank: string;
  type: SetupAccountType;
  offbudget: boolean;
  files: SetupFile[];
  entered: number | null; // integer cents as typed; for 'credit', positive = owed
};

export type KnownBalance = {
  source: 'ledger' | 'csv-balance' | 'entered';
  amount: number; // integer cents, signed as stored
  date: string;
};

export type BalanceBlock =
  | { kind: 'no-balance'; asOf: string } // asOf: last transaction date, or today with no files
  | { kind: 'ledger-after-end'; ledgerDate: string; end: string };

export type SkippedRow = { row: SetupRow; keptFromFileId: string };

export type TransferPair = { outRowId: string; inRowId: string };

export type ReviewAccount = {
  draftId: string;
  rows: SetupRow[]; // kept rows, sorted by date ascending
  skipped: SkippedRow[];
  from: string | null;
  to: string | null;
  known: KnownBalance | null;
  starting: { amount: number; date: string } | null;
  ending: number | null;
  block: 'needs-columns' | BalanceBlock | null;
};

export type Review = {
  accounts: ReviewAccount[];
  candidatePairs: TransferPair[];
  transactionCount: number;
  ready: boolean; // no account has a block
};

const TRANSFER_WINDOW_DAYS = 5;

type LocatedRow = { draftId: string; row: SetupRow };

// Rows are compared only with rows of earlier files, never within one file,
// because two identical purchases in one statement are two purchases.
export function dedupeAcrossFiles(files: SetupFile[]): {
  kept: SetupRow[];
  skipped: SkippedRow[];
} {
  const kept: SetupRow[] = [];
  const skipped: SkippedRow[] = [];
  const keptByImportedId = new Map<string, SetupRow[]>();
  const keptByKey = new Map<string, SetupRow[]>();

  for (const file of files) {
    // Kept rows that a row of this file has already matched; each matches once
    const matched = new Set<string>();
    const added: SetupRow[] = [];

    for (const row of file.rows) {
      const copyOf = findCopy(row, keptByImportedId, keptByKey, matched);
      if (copyOf) {
        matched.add(copyOf.id);
        skipped.push({ row, keptFromFileId: copyOf.fileId });
      } else {
        added.push(row);
      }
    }

    // Indexed only after the whole file, so a file never matches itself
    for (const row of added) {
      kept.push(row);
      addTo(keptByKey, rowKey(row), row);
      if (row.importedId) {
        addTo(keptByImportedId, row.importedId, row);
      }
    }
  }

  return { kept, skipped };
}

export function knownBalance(
  account: SetupAccountDraft,
  kept: SetupRow[],
  today: string,
): KnownBalance | BalanceBlock {
  const ledgers = account.files.flatMap(file => {
    const statement = file.statement;
    if (
      statement === null ||
      statement.ledgerBalance === null ||
      statement.ledgerDate === null
    ) {
      return [];
    }
    return [
      {
        amount: statement.ledgerBalance,
        date: statement.ledgerDate,
        end: statement.end,
      },
    ];
  });

  const ledger = latest(
    ledgers.filter(l => l.end === null || l.date <= l.end),
    l => l.date,
  );
  if (ledger) {
    return { source: 'ledger', amount: ledger.amount, date: ledger.date };
  }

  const csvBalance = latest(
    account.files.flatMap(file => (file.csvBalance ? [file.csvBalance] : [])),
    b => b.date,
  );
  if (csvBalance) {
    return {
      source: 'csv-balance',
      amount: csvBalance.amount,
      date: csvBalance.date,
    };
  }

  // A ledger dated after its statement's end misses the activity in between
  const stale = latest(
    ledgers.flatMap(l =>
      l.end !== null && l.date > l.end
        ? [{ ledgerDate: l.date, end: l.end }]
        : [],
    ),
    l => l.end,
  );
  const block: BalanceBlock = stale
    ? { kind: 'ledger-after-end', ledgerDate: stale.ledgerDate, end: stale.end }
    : {
        kind: 'no-balance',
        asOf: latest(kept, row => row.date)?.date ?? today,
      };

  if (account.entered === null) {
    return block;
  }
  return {
    source: 'entered',
    // A card balance is typed as the amount owed; `0 -` avoids storing -0
    amount: account.type === 'credit' ? 0 - account.entered : account.entered,
    date: block.kind === 'ledger-after-end' ? block.end : block.asOf,
  };
}

export function startingBalance(
  rows: SetupRow[],
  known: KnownBalance,
): { amount: number; date: string } {
  const earliest = earliestDate(rows);
  if (earliest === null) {
    return { amount: known.amount, date: known.date };
  }
  const netToKnownDate = sumAmounts(rows.filter(row => row.date <= known.date));
  return { amount: known.amount - netToKnownDate, date: earliest };
}

// Greedy and deterministic: out-rows in date then id order each take the
// closest-dated eligible in-row, ties going to the lower in-row id.
export function findTransferPairs(
  accounts: Array<{ draftId: string; rows: SetupRow[] }>,
): TransferPair[] {
  const located: LocatedRow[] = accounts.flatMap(account =>
    account.rows.map(row => ({ draftId: account.draftId, row })),
  );

  const inRowsByAmount = new Map<number, LocatedRow[]>();
  for (const candidate of located) {
    if (candidate.row.amount > 0) {
      addTo(inRowsByAmount, candidate.row.amount, candidate);
    }
  }

  const outRows = located
    .filter(candidate => candidate.row.amount < 0)
    .sort(
      (a, b) =>
        compareStrings(a.row.date, b.row.date) ||
        compareStrings(a.row.id, b.row.id),
    );

  const paired = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const out of outRows) {
    let best: { into: LocatedRow; days: number } | null = null;
    for (const into of inRowsByAmount.get(-out.row.amount) ?? []) {
      if (paired.has(into.row.id) || !isTransferMatch(out, into)) {
        continue;
      }
      const days = daysApart(out.row, into.row);
      if (
        best === null ||
        days < best.days ||
        (days === best.days && into.row.id < best.into.row.id)
      ) {
        best = { into, days };
      }
    }
    if (best) {
      paired.add(best.into.row.id);
      pairs.push({ outRowId: out.row.id, inRowId: best.into.row.id });
    }
  }

  return pairs;
}

export function validateTransferPair(
  pair: TransferPair,
  rowsById: Map<string, { draftId: string; row: SetupRow }>,
): boolean {
  const out = rowsById.get(pair.outRowId);
  const into = rowsById.get(pair.inRowId);
  return out !== undefined && into !== undefined && isTransferMatch(out, into);
}

export function buildReview(
  accounts: SetupAccountDraft[],
  today: string,
): Review {
  const reviewed = accounts.map(account => reviewAccount(account, today));
  return {
    accounts: reviewed,
    candidatePairs: findTransferPairs(
      reviewed.map(account => ({
        draftId: account.draftId,
        rows: account.rows,
      })),
    ),
    transactionCount: reviewed.reduce(
      (count, account) => count + account.rows.length,
      0,
    ),
    ready: reviewed.every(account => account.block === null),
  };
}

function reviewAccount(
  account: SetupAccountDraft,
  today: string,
): ReviewAccount {
  const { kept, skipped } = dedupeAcrossFiles(account.files);
  // Array.prototype.sort is stable, so rows on one day keep their file order
  const rows = [...kept].sort((a, b) => compareStrings(a.date, b.date));
  const base = {
    draftId: account.id,
    rows,
    skipped,
    from: rows.length > 0 ? rows[0].date : null,
    to: rows.length > 0 ? rows[rows.length - 1].date : null,
  };
  const unresolved = { known: null, starting: null, ending: null };

  // An unmapped file's rows are missing, so no balance can be trusted yet
  if (account.files.some(file => file.needsMapping)) {
    return { ...base, ...unresolved, block: 'needs-columns' };
  }

  const known = knownBalance(account, rows, today);
  if (!('source' in known)) {
    return { ...base, ...unresolved, block: known };
  }

  const starting = startingBalance(rows, known);
  return {
    ...base,
    known,
    starting,
    ending: starting.amount + sumAmounts(rows),
    block: null,
  };
}

function rowKey(row: SetupRow): string {
  return `${row.date}|${row.amount}|${row.payeeName}`;
}

function findCopy(
  row: SetupRow,
  keptByImportedId: Map<string, SetupRow[]>,
  keptByKey: Map<string, SetupRow[]>,
  matched: Set<string>,
): SetupRow | undefined {
  if (row.importedId) {
    const sameId = keptByImportedId
      .get(row.importedId)
      ?.find(k => !matched.has(k.id));
    if (sameId) {
      return sameId;
    }
  }
  // Two rows that both carry an imported id and did not match on it differ
  return keptByKey
    .get(rowKey(row))
    ?.find(k => !matched.has(k.id) && (!k.importedId || !row.importedId));
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function latest<T>(items: T[], dateOf: (item: T) => string): T | undefined {
  let found: T | undefined;
  for (const item of items) {
    if (found === undefined || dateOf(item) > dateOf(found)) {
      found = item;
    }
  }
  return found;
}

function earliestDate(rows: SetupRow[]): string | null {
  let earliest: string | null = null;
  for (const row of rows) {
    if (earliest === null || row.date < earliest) {
      earliest = row.date;
    }
  }
  return earliest;
}

function sumAmounts(rows: SetupRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function isTransferMatch(out: LocatedRow, into: LocatedRow): boolean {
  return (
    out.draftId !== into.draftId &&
    out.row.amount < 0 &&
    into.row.amount === -out.row.amount &&
    daysApart(out.row, into.row) <= TRANSFER_WINDOW_DAYS
  );
}

function daysApart(a: SetupRow, b: SetupRow): number {
  return Math.abs(monthUtils.differenceInCalendarDays(a.date, b.date));
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
