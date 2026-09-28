# Bank File Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-run page at `/setup` that turns files downloaded from banks into accounts, transactions and correct starting balances, reviewed live and created in one all-or-nothing, undoable step.

**Architecture:** Files are read in the browser and parsed on the server from their bytes, with OFX statements returning their bank, account, dates and ledger balance. Pure functions in `loot-core/src/shared/bank-file-setup.ts` compute duplicates across files, starting balances, transfer pairs and the review; the client runs them on every edit and the server re-checks them at Create. `setup-create` computes every row in memory (reads, no writes), then writes them in one `batchMessages` of raw inserts.

**Tech Stack:** TypeScript, React (React Compiler), react-aria-components (`FileTrigger`, `DropZone`), loot-core server handlers over the worker connection, Vitest, Testing Library, Playwright.

**Spec:** [PRD.md](../bank-file-setup-prd.md), [ux/directions.md](../bank-file-setup-ux.md) (direction E), [technical-design.md](../bank-file-setup-tdd.md). The design's decision numbers are cited as D1 to D10.

## Global Constraints

- Run every `yarn` command from the repository root. Workspace tests: `yarn workspace @actual-app/core run test:node <path>` (loot-core's `test` script runs every suite and takes no path) and `yarn workspace @actual-app/web run test <path>`.
- New files are type-strict: never add `// @ts-strict-ignore`. Prefer `satisfies` over `as`.
- Every user-facing string goes through `Trans` or `t()`; standalone amounts render with `FinancialText`.
- Amounts are integer cents everywhere in the shared module and server (`amountToInteger` at the parse boundary). A negative amount is money leaving the account.
- A credit card balance is entered as a positive amount owed and stored as its negative.
- A starting balance is dated on the earliest imported transaction and equals the known balance minus the net of the imported transactions dated on or before the known balance's date.
- Duplicate rows are compared only across files, never within one file (D5).
- Transfer pairs: opposite signs, equal absolute amount, dates at most 5 days apart, different accounts, each row in at most one pair (PRD Requirement 10).
- Unanswered and rejected pairs import as two ordinary transactions and never block Create.
- Create is all or nothing. Step 2 of `setup-create` calls only `db.insertWithUUID`, `db.insertPayee` and `db.insertTransaction`; never `createAccount`, `insertAccount`, `createPayee` or `batchUpdateTransactions` (D6).
- New accounts get `account_group_id` null (ungrouped), `closed` 0, and `sort_order` after the existing accounts in their on-budget or off-budget set.
- No schema or migration changes. The accounts table's unused bank-sync columns (`type`, `mask`, `bank`) stay unused.
- The flow is desktop and wide web only: the route is wrapped in `NarrowNotSupported`, and every entry point is hidden when `isNarrowWidth` is true.
- Copy (exact):
  - Choice title: "How do you want to start?"
  - Choice options: "Set up from bank files" with "Add your accounts and the files you downloaded from your banks. Nothing is created until you confirm."; "Start with an empty budget" with "Add accounts yourself. You can still set up from bank files later."
  - Page title and intro: "Your accounts"; "Add each bank account, then the files you downloaded for it. Nothing is created until you click Create."
  - Review heading: "What will be created", with "Updates as you edit"
  - States: "Needs columns"; "Needs a balance"
  - Balance questions: "What was the balance on {{date}}?"; "How much did you owe on {{date}}?"; "What is the balance today?"; help: "Use the balance on your statement or in your bank's app for that day. Pending transactions are not in your downloaded file."
  - Ledger after statement: "This file's balance is dated {{ledgerDate}}, after its last transaction on {{end}}. Activity in between is missing, so enter the balance on {{end}}."
  - Duplicates: "{{count}} duplicates skipped"
  - Transfers: heading "Likely transfers"; body "The same amount leaving one of your accounts and arriving in another. A confirmed pair becomes a transfer, so it is not counted as spending and income."; buttons "Confirm" and "Keep separate"
  - Footer when blocked: "Before you can create: {{list}}."; when ready: "{{accounts}} and {{transactions}} will be created."; unanswered: "{{count}} likely transfer not answered: it will be imported as two transactions."
  - Summary after Create: "Created {{accounts}} and {{transactions}}. They are uncategorized; start with the ones below. Past months will look overspent because nothing was budgeted in them."
  - Empty budget offer: "No accounts yet" with "Set up this budget from the files you downloaded from your banks." and button "Set up from bank files"
  - Leave confirmation: "Leave setup? The accounts you added have not been created."
  - Add account entries: "Set up from bank files"; the local account form's lead-in: "Starting from files you downloaded from your banks?"
  - Create failure: "Nothing was created. Check the accounts and try again."
  - A file with unreadable rows: "Fix or remove this file"
- Accessibility: one polite live region per page (`LiveRegion`); never `role="alert"` for flow messages. A blocked Create stays focusable with `aria-disabled="true"` and `aria-describedby` pointing at the footer reason. Incomplete account cards never collapse. Gold states use Page Ink text with a gold border and icon, never gold text.
- Repo rules: commit messages start with `[AI]`; stage only the files named in the task.

## Review Focus

1. **Identical purchases in one file.** Two $4.50 coffees at the same shop on the same day in one CSV must both import; only a copy of them in a second file is skipped. Pinned in Task 3.
2. **A stale transfer answer.** The person confirms a pair, then removes one of its files or accounts, or remaps the CSV so the amounts change. Create must not link rows that no longer exist or no longer match. Pinned in Task 3 (`validateTransferPair`), Task 7 (server rejects), and Task 10 (the reducer drops answers whose rows are gone).
3. **Setup inside a budget that already has payees and rules.** Entered from Add account, the flow must reuse existing payees by name and create no duplicate when a rule renames a payee, even if Create then fails. Pinned in Task 6.
4. **A second Create.** A double click, or Create pressed again after a slow first one, must not create every account twice. Pinned in Task 10 (button busy and page disabled) and Task 7 (a post-commit error still returns success).
5. **A ledger balance dated after the statement's last transaction.** It must not be used; the card asks for the balance on the statement's end date. Pinned in Task 3 and in the parser fixture test in Task 2 (`html-vals.qfx`).

---

## File Structure

loot-core (`packages/loot-core/src/`):

- Modify `server/transactions/import/ofx2json.ts`: return `statements` alongside the merged `transactions`.
- Modify `server/transactions/import/parse-file.ts`: `parseFileContents(name, bytes, options)`, `.qbo`, QIF from bytes, `statements` in the result.
- Create `mocks/files/two-statements.ofx`, `mocks/files/mixed-bank-card.ofx`, `mocks/files/data.qbo`: parser fixtures.
- Create `shared/bank-file-setup.ts` and `shared/bank-file-setup.test.ts`: the pure functions and their types.
- Modify `server/transactions/transaction-rules.ts`: `runRules` option `resolvePayeeNames`.
- Create `server/bank-file-setup/plan-create.ts` and `.test.ts`: step 1 of Create, returning every row to insert.
- Create `server/bank-file-setup/app.ts` and `app.test.ts`: the `setup-parse-file` and `setup-create` handlers and step 2.
- Modify `server/main.ts` and `types/handlers.ts`: register the new app.
- Modify `server/accounts/sync.ts` (export `normalizeImportedPayeeName`, `makeSplitTransaction`) and `server/accounts/payees.ts` (export `getStartingBalanceCategory`).
- Create `server/bank-file-setup/create-cost.spike.test.ts`: the Task 1 measurement, skipped unless `SETUP_SPIKE=1`.

desktop-client (`packages/desktop-client/src/`):

- Create `components/LiveRegion.tsx` and `.test.tsx`: polite announcements.
- Create `components/modals/ImportTransactionsModal/importSettings.ts` and `.test.ts`: the saved-settings key set, extracted from the import modal.
- Modify `components/modals/ImportTransactionsModal/ImportTransactionsModal.tsx`: call the extracted helper; no behavior change.
- Modify `components/modals/ImportTransactionsModal/utils.ts`: optional `balance` in `FieldMapping`; export `getInitialMappings` and `getInitialDateFormat`.
- Modify `components/modals/ImportTransactionsModal/FieldMappings.tsx`, `DateFormatSelect.tsx`, `SelectField.tsx`, and `packages/component-library/src/Select.tsx`: accessible names for every column picker.
- Modify `packages/desktop-client/package.json`: subpath-import entries for the new `.ts` modules.
- Create `components/bank-file-setup/CsvMappingModal.tsx` and `.test.tsx`; modify `modals/modalsSlice.ts` and `components/Modals.tsx` to register it.
- Create `components/bank-file-setup/csvRows.ts` and `.test.ts`: raw CSV rows plus a mapping to `SetupRow[]`.
- Create `components/bank-file-setup/useSetupDraft.ts` and `.test.ts`: the page's reducer.
- Create `components/bank-file-setup/SetupPage.tsx`, `StartChoice.tsx`, `AccountCard.tsx`, `ReviewTable.tsx`, `TransferPairs.tsx`, `SetupFooter.tsx`, and `SetupPage.test.tsx`.
- Modify `components/FinancesApp.tsx`: the `/setup` route.
- Modify `budgetfiles/budgetfilesSlice.ts`, `components/manager/WelcomeScreen.tsx`, `components/manager/BudgetFileSelection.tsx`: open setup after creating a budget.
- Create `components/budget/NoAccountsOffer.tsx`; modify the budget page to show it.
- Modify `components/modals/CreateAccountModal.tsx`, `components/modals/CreateLocalAccountModal.tsx`: the "Set up from bank files" entry.
- Modify `components/tour/TourAutoOffer.ts`: no offer on `/setup`.
- Modify `components/responsive/wide.ts`: lazy `SetupPage`.
- Create `e2e/bank-file-setup.test.ts`, `e2e/page-models/setup-page.ts`, `e2e/data/setup-checking.qfx`, `e2e/data/setup-card.csv`; modify `e2e/page-models/configuration-page.ts`.

---

## Interface Contract

Every task codes against these names and types. They are defined in the task named in brackets; later tasks import them and must not redefine them.

```ts
// packages/loot-core/src/server/transactions/import/ofx2json.ts  [Task 2]
export type OFXStatement = {
  kind: 'bank' | 'credit' | 'investment';
  org: string | null; // SIGNONMSGSRSV1.SONRS.FI.ORG
  fid: string | null; // SIGNONMSGSRSV1.SONRS.FI.FID
  bankId: string | null; // BANKACCTFROM.BANKID
  accountId: string | null; // BANKACCTFROM.ACCTID or CCACCTFROM.ACCTID
  accountType: string | null; // BANKACCTFROM.ACCTTYPE, e.g. 'CHECKING'
  start: string | null; // BANKTRANLIST.DTSTART as YYYY-MM-DD
  end: string | null; // BANKTRANLIST.DTEND as YYYY-MM-DD
  ledgerBalance: number | null; // LEDGERBAL.BALAMT, decimal
  ledgerDate: string | null; // LEDGERBAL.DTASOF as YYYY-MM-DD
  transactions: OFXTransaction[];
};
// OFXParseResult gains: statements: OFXStatement[]

// packages/loot-core/src/server/transactions/import/parse-file.ts  [Task 2]
export type ParsedStatement = Omit<OFXStatement, 'transactions'> & {
  transactions: StructuredTransaction[]; // same shape as the merged list
};
export type ParseFileResult = {
  errors: ParseError[];
  transactions?: Transaction[];
  statements?: ParsedStatement[]; // OFX, QFX and QBO only
};
export async function parseFileContents(
  name: string, // used only for its extension
  bytes: Uint8Array,
  options?: ParseFileOptions,
): Promise<ParseFileResult>;
// parseFile(filepath, options) keeps its signature and reads the file, then calls parseFileContents.

// packages/loot-core/src/shared/bank-file-setup.ts  [Task 3]
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

export function dedupeAcrossFiles(files: SetupFile[]): {
  kept: SetupRow[];
  skipped: SkippedRow[];
};
export function knownBalance(
  account: SetupAccountDraft,
  kept: SetupRow[],
  today: string,
): KnownBalance | BalanceBlock;
export function startingBalance(
  rows: SetupRow[],
  known: KnownBalance,
): { amount: number; date: string };
export function findTransferPairs(
  accounts: Array<{ draftId: string; rows: SetupRow[] }>,
): TransferPair[];
export function validateTransferPair(
  pair: TransferPair,
  rowsById: Map<string, { draftId: string; row: SetupRow }>,
): boolean;
export function buildReview(
  accounts: SetupAccountDraft[],
  today: string,
): Review;

// packages/loot-core/src/server/transactions/transaction-rules.ts  [Task 4]
export async function runRules(
  trans,
  accounts?: Map<string, db.DbAccount> | null,
  options?: { resolvePayeeNames?: boolean }, // default true; false leaves payee 'new' + payee_name
);

// packages/loot-core/src/server/bank-file-setup/plan-create.ts  [Task 5, extended in Task 6]
export type SetupCreateInput = {
  accounts: SetupAccountDraft[];
  confirmedPairs: TransferPair[];
  today: string;
};
export type CreatePlan = {
  accounts: Array<Record<string, unknown>>; // rows for 'accounts', with id
  payees: Array<Record<string, unknown>>; // rows for 'payees', with id (transfer and new)
  transactions: Array<Record<string, unknown>>; // rows for insertTransaction, with id
  accountIdByDraftId: Record<string, string>;
  transactionCount: number; // imported rows only, not starting balances or counterparts
};
export async function planCreate(input: SetupCreateInput): Promise<CreatePlan>; // throws SetupValidationError
export class SetupValidationError extends Error {}

// packages/loot-core/src/server/bank-file-setup/app.ts  [Task 7]
export type BankFileSetupHandlers = {
  'setup-parse-file': (args: {
    name: string;
    bytes: Uint8Array;
    options?: ParseFileOptions;
  }) => Promise<ParseFileResult>;
  'setup-create': (input: SetupCreateInput) => Promise<
    | {
        ok: true;
        accountIds: string[];
        transactionCount: number;
        warning?: string;
      }
    | { ok: false; error: string }
  >;
};

// packages/desktop-client/src/components/LiveRegion.tsx  [Task 8]
export function LiveRegion(): JSX.Element; // renders the region; mount once per page
export function useAnnounce(): (message: string) => void;

// packages/desktop-client/src/components/modals/ImportTransactionsModal/importSettings.ts  [Task 9]
export type ImportSettings = {
  /* the fields the modal saves today; see Task 9 */
};
export function importSettingsPrefs(
  accountId: string,
  fileType: string,
  settings: ImportSettings,
): Record<string, string>; // synced pref key -> value, exactly as the modal writes them

// packages/desktop-client/src/components/bank-file-setup/csvRows.ts  [Task 9]
export function csvToSetupRows(
  fileId: string,
  rawRows: Array<Record<string, string> | string[]>,
  mapping: CsvMapping,
): {
  rows: SetupRow[];
  balance: { date: string; amount: number } | null;
  errors: string[];
};
export type CsvMapping = {
  fieldMappings: FieldMapping;
  dateFormat: string;
  flipAmount: boolean;
  multiplier: string;
  inOutMode: boolean;
  outValue: string;
  settings: ImportSettings;
};

// modal registry  [Task 9]
// name: 'bank-file-setup-csv-mapping'
// options: { fileName: string; rawRows: Array<Record<string, string> | string[]>; initial: CsvMapping | null; onDone: (mapping: CsvMapping) => void }

// packages/desktop-client/src/components/bank-file-setup/useSetupDraft.ts  [Task 10]
export type SetupState = {
  step: 'choice' | 'accounts';
  accounts: SetupAccountDraft[];
  answers: Record<string, 'confirmed' | 'separate'>; // key `${outRowId}|${inRowId}`
  mappings: Record<string, CsvMapping>; // by file id
  rawCsv: Record<string, Array<Record<string, string> | string[]>>; // by file id
  creating: boolean;
  error: string | null;
};
export type SetupAction =
  | { type: 'choose-setup' }
  | { type: 'add-account' }
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
      rawCsv?: Array<Record<string, string> | string[]>;
    }
  | { type: 'remove-file'; draftId: string; fileId: string }
  | {
      type: 'map-csv';
      fileId: string;
      mapping: CsvMapping;
      rows: SetupRow[];
      balance: { date: string; amount: number } | null;
    }
  | {
      type: 'answer-pair';
      pair: TransferPair;
      answer: 'confirmed' | 'separate' | null;
    }
  | { type: 'create-start' }
  | { type: 'create-failed'; error: string };
export function setupReducer(
  state: SetupState,
  action: SetupAction,
): SetupState;
export const initialSetupState: SetupState;

// createBudget thunk option  [Task 11]
// createBudget({ ..., openSetup?: boolean }) navigates to '/setup' after prefs load when true.
```

### Contract amendments

The task writers checked the contract against the real code. These amendments are binding and supersede the blocks above where they differ.

1. **`runRules` with `resolvePayeeNames: false` still resolves a name to an existing payee** (a read). Only a name with no payee is left as `payee: 'new'` plus `payee_name`, and nothing is inserted. Otherwise a later rule keyed on that payee's id would stop firing, unlike today's import. `finalizeTransactionForRules` takes the same option. [Task 4; Task 6 handles both an existing id and `'new'`.]
2. **`StructuredTransaction` gains `imported_id?: string` and is exported; `OFXTransaction` and `ParseError` are exported.** [Task 2]
3. **`ParsedStatement` gains `errors: ParseError[]`** for that statement's own rows. The file-level `errors` still come from the merged list, exactly as today. [Task 2; Task 10 shows them and blocks Create.]
4. **`CreatePlan.payees` is `PlannedPayee[]`**, with `PlannedPayee = { id: string; name: string; transfer_acct?: string }`, because `db.insertPayee`'s parameter does not accept a `Record` without a cast. [Task 5]
5. **`planCreate` rejects a confirmed set in which any row id appears twice**, in addition to `validateTransferPair` per pair. [Task 5]
6. **`SetupAction`'s `choose-setup` and `add-account` carry `draftId: string`.** The caller passes `uuidv4()`, which keeps the reducer pure and lets a card add accounts for a file's extra statements. [Task 10]
7. **A file with several statements becomes several `SetupFile`s with ids `${sha256}#${index}`**; single-statement and non-OFX files keep the plain hash. `fileHash(id)` returns the hash part. The reducer refuses the same bytes anywhere in the draft, so row ids stay unique. [Task 10]
8. **`SetupState` gains `fileErrors: Record<string, string[]>`, and `add-file` gains `errors?: string[]`.** [Task 10]
9. **`useSetupDraft(options?: { skipChoice?: boolean })`**, and `/setup` accepts route state `{ skipChoice: true }` from in-budget entry points. [Task 13]
10. **`useAnnounce` is backed by a module-level store** read with `useSyncExternalStore`, so `SetupPage` can mount `LiveRegion` and announce itself. The region clears when it unmounts. [Task 8]
11. **Additive exports that later tasks use:** `SetupCreateResult` (app.ts); `normalizeImportedPayeeName` (accounts/sync.ts) and `getStartingBalanceCategory` (accounts/payees.ts), extracted so Create shares code with the import instead of copying it; `makeSplitTransaction` (accounts/sync.ts, now exported, body unchanged); `isOfxFile`, `isCamtFile`, `defaultImportSettings` (importSettings.ts); `getInitialMappings`, `getInitialDateFormat` (utils.ts); `CsvRawRow`, `csvRowRecord`, `buildCsvMapping`, `initialCsvMapping` (csvRows.ts); `SetupPage` in `components/responsive/wide.ts`.

Judgment calls the tasks rely on, recorded once:

- A ledger with no `end` counts as usable; with several usable balances, the latest-dated wins.
- An entered balance is dated on the question the card asked: the `end` of a ledger-after-end block, else the last kept row's date, else today.
- A `'needs-columns'` account has `known`, `starting` and `ending` null.
- A starting balance of exactly 0 creates no transaction, as `createAccount` does.
- A confirmed pair wins over a split rule: the row stays whole so it can be linked.
- A row a rule deletes is dropped from the plan and from `transactionCount`.
- Server error strings are untranslated; the page shows "Nothing was created. Check the accounts and try again." and logs the detail.
- CSV and TSV files are parsed with `hasHeaderRow: true` and the delimiter from `defaultImportSettings(name)`.
- Statements are returned in the order bank, credit card, investment.

---

## Tasks

Tasks run in order. Task 1 is a gate: if it fails its threshold, stop and report before Task 5.

### Task 1: Measure Create's cost (spike)

A measurement, not a feature: it runs the two expensive parts of Create at full size on the node backend and reports the times. The file is committed skipped, so anyone can rerun it with `SETUP_SPIKE=1`.

**Files:**

- Create: `packages/loot-core/src/server/bank-file-setup/create-cost.spike.test.ts`

**Interfaces:**

- Consumes: `runRules(trans, accounts)` (`transaction-rules.ts:321`), `batchMessages` (`sync/index.ts:701`), `db.insertWithUUID`, `db.insertPayee`, `db.insertTransaction`, `createAllBudgets` (`budget/base.ts:376`), `sheet.loadSpreadsheet`, `setSyncingMode`.
- Produces: no code interface. Produces the measured cost and the gate decision recorded in the commit message.

**What it measures.** 5,000 rows across 3 accounts (2,500 checking, 2,000 card, 500 savings off budget) over two years, 40 merchants of which 12 already exist as payees, and 36 rules (12 pre-stage renames by `imported_payee`, 12 categories by payee, 6 post-stage notes, 6 two-condition category rules with an amount test). It times `runRules` per row against an accounts map holding the new accounts (as Task 6's step 1 will), then one `batchMessages` that inserts the accounts, transfer payees, the Starting Balance payee, 28 new payees, 3 starting balances and 5,000 transactions with the raw inserts only, split into building the messages and the `applyMessages` that ends the batch. It runs with the spreadsheet loaded (so `applyMessages` does the budget triggers a real budget does), real timestamps, and syncing `offline` (so `messages_crdt` and the merkle are written, as in a real budget, without contacting a server). It then times the post-commit budget-month creation.

**The gate.** If `runRules` total plus the batch (build plus `applyMessages`) exceeds 10 seconds on node for 5,000 rows, stop and report to the plan owner before Task 5. The test asserts this, so a run over the limit fails.

**Why node numbers are the gate.** The node run is automated and reproducible, and it is the only one that isolates rules and `applyMessages` from the rest of the app. The web backend runs the same code over SQLite compiled to WebAssembly with IndexedDB persistence, which is slower by an amount only a browser run shows; Step 4 gives a manual check that uses today's per-account import of the same 5,000 rows as a stand-in (it does rules, per-row duplicate queries and a batched write, so it costs more than Create's step 2). If that browser import takes more than 10 seconds, report it alongside the node numbers; it does not by itself stop the build.

- [ ] **Step 1: Write the spike**

`packages/loot-core/src/server/bank-file-setup/create-cost.spike.test.ts`:

```ts
// Measures what Create will cost at 5,000 transactions (technical design
// D10): rules for every row, then one batch of raw inserts and the
// applyMessages it ends in. Skipped unless SETUP_SPIKE=1:
//
//   SETUP_SPIKE=1 yarn workspace @actual-app/core run test:node src/server/bank-file-setup/create-cost.spike.test.ts
//
// Set SETUP_SPIKE_CSV=/absolute/path.csv to also write the generated rows as
// a CSV, for timing the same data through the per-account import in the
// browser.
import * as nativeFs from 'fs';

import { createAllBudgets } from '#server/budget/base';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as sheet from '#server/sheet';
import { batchMessages, setSyncingMode } from '#server/sync';
import {
  insertRule,
  loadRules,
  runRules,
} from '#server/transactions/transaction-rules';
import type { TransactionEntity } from '#types/models';

const { restoreDateNow, restoreFakeDateNow } = global as typeof globalThis & {
  restoreDateNow: () => void;
  restoreFakeDateNow: () => void;
};

const ROWS = 5000;
const GATE_MS = 10_000;

// The accounts Create would make, as rows; share is the part of ROWS each gets
const ACCOUNTS: Array<{ row: db.DbAccount; share: number }> = [
  { row: accountRow('spike-checking', 'Checking', 0, 1), share: 0.5 },
  { row: accountRow('spike-card', 'Card', 0, 2), share: 0.4 },
  { row: accountRow('spike-savings', 'Savings', 1, 3), share: 0.1 },
];

function accountRow(
  id: string,
  name: string,
  offbudget: 0 | 1,
  position: number,
): db.DbAccount {
  return {
    id,
    name,
    offbudget,
    closed: 0,
    tombstone: 0,
    sort_order: position * 16384,
    account_group_id: null,
  };
}

// 40 merchants; the first 12 already exist as payees and have rules
const MERCHANTS = Array.from({ length: 40 }, (_, i) => `MERCHANT${i}`);
const RULED = 12;

type SpikeRow = {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee: string;
  imported_payee: string;
  imported_id: string;
  notes: string | null;
  category: string | null;
  cleared: boolean;
};

// Deterministic, so every run measures the same data
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function dayOffset(start: string, days: number): string {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function generateRows(payeeIdByMerchant: Map<string, string>): SpikeRow[] {
  const random = makeRandom(42);
  const rows: SpikeRow[] = [];
  for (const { row: account, share } of ACCOUNTS) {
    const count = Math.round(ROWS * share);
    for (let i = 0; i < count; i++) {
      const merchant = MERCHANTS[Math.floor(random() * MERCHANTS.length)];
      rows.push({
        id: `${account.id}-row-${i}`,
        account: account.id,
        // Two years of history
        date: dayOffset('2024-09-27', Math.floor(random() * 730)),
        amount: -Math.floor(random() * 20000) - 100,
        payee: payeeIdByMerchant.get(merchant) ?? '',
        imported_payee: `${merchant} STORE ${Math.floor(random() * 900) + 100}`,
        imported_id: `${account.id}-fitid-${i}`,
        notes: null,
        category: null,
        cleared: true,
      });
    }
  }
  return rows;
}

async function seedBudget() {
  await db.insertCategoryGroup({ id: 'spike-group', name: 'Spending' });
  await db.insertCategoryGroup({
    id: 'spike-income',
    name: 'Income',
    is_income: 1,
  });
  await db.insertCategory({
    id: 'spike-starting',
    name: 'Starting Balances',
    cat_group: 'spike-income',
    is_income: 1,
  });
  for (let i = 0; i < RULED; i++) {
    await db.insertCategory({
      id: `spike-cat-${i}`,
      name: `Category ${i}`,
      cat_group: 'spike-group',
    });
    await db.insertPayee({ id: `spike-payee-${i}`, name: `Merchant ${i}` });
  }

  // 36 rules: 12 renames, 12 categories by payee, 6 notes, 6 by amount
  for (let i = 0; i < RULED; i++) {
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'contains', field: 'imported_payee', value: `MERCHANT${i} ` },
      ],
      actions: [{ op: 'set', field: 'payee', value: `spike-payee-${i}` }],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: `spike-payee-${i}` }],
      actions: [{ op: 'set', field: 'category', value: `spike-cat-${i}` }],
    });
  }
  for (let i = 0; i < 6; i++) {
    await insertRule({
      stage: 'post',
      conditionsOp: 'and',
      conditions: [
        {
          op: 'contains',
          field: 'imported_payee',
          value: `MERCHANT${RULED + i} `,
        },
      ],
      actions: [{ op: 'set', field: 'notes', value: `note ${i}` }],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        {
          op: 'contains',
          field: 'imported_payee',
          value: `MERCHANT${RULED + 6 + i} `,
        },
        { op: 'lt', field: 'amount', value: -10000 },
      ],
      actions: [{ op: 'set', field: 'category', value: `spike-cat-${i}` }],
    });
  }
}

function report(lines: Array<[string, string]>) {
  const width = Math.max(...lines.map(([label]) => label.length));
  process.stderr.write(
    '\nCreate cost spike (node backend)\n' +
      lines
        .map(([label, value]) => `  ${label.padEnd(width)}  ${value}`)
        .join('\n') +
      '\n\n',
  );
}

describe.skipIf(process.env.SETUP_SPIKE !== '1')('Create cost spike', () => {
  beforeEach(async () => {
    // The budget months follow the current month; place it after the data
    global.currentMonth = '2026-09';
    await global.emptyDatabase()();
    await loadMappings();
    await loadRules();
    await sheet.loadSpreadsheet(db);
    // Real timestamps: 75,000 messages at one fake millisecond would
    // overflow the HLC counter
    restoreDateNow();
    // Write messages_crdt and the merkle as a real budget does, without
    // trying to reach a sync server
    setSyncingMode('offline');
  });

  afterEach(() => {
    global.currentMonth = null;
    setSyncingMode('disabled');
    restoreFakeDateNow();
  });

  test(`rules and one batch for ${ROWS} rows across ${ACCOUNTS.length} accounts`, async () => {
    await seedBudget();
    await createAllBudgets();
    await sheet.waitOnSpreadsheet();

    const newPayees = MERCHANTS.slice(RULED).map((merchant, i) => ({
      id: `spike-new-payee-${i}`,
      name: `Merchant ${RULED + i}`,
      merchant,
    }));
    const payeeIdByMerchant = new Map([
      ...MERCHANTS.slice(0, RULED).map(
        (merchant, i) => [merchant, `spike-payee-${i}`] as const,
      ),
      ...newPayees.map(payee => [payee.merchant, payee.id] as const),
    ]);
    const rows = generateRows(payeeIdByMerchant);
    expect(rows).toHaveLength(ROWS);

    if (process.env.SETUP_SPIKE_CSV) {
      nativeFs.writeFileSync(
        process.env.SETUP_SPIKE_CSV,
        'Date,Description,Amount\n' +
          rows
            .map(
              row =>
                `${row.date},${row.imported_payee},${(row.amount / 100).toFixed(2)}`,
            )
            .join('\n') +
          '\n',
      );
    }

    // Step 1's rules, against an accounts map that holds the new accounts
    const accountsMap = new Map(ACCOUNTS.map(({ row }) => [row.id, row]));
    const rulesStart = performance.now();
    const ruled: TransactionEntity[] = [];
    for (const row of rows) {
      ruled.push(await runRules(row, accountsMap));
    }
    const rulesMs = performance.now() - rulesStart;
    const categorized = ruled.filter(row => row.category != null).length;

    // Step 2: one batch of raw inserts
    const batchStart = performance.now();
    let builtAt = 0;
    await batchMessages(async () => {
      for (const { row: account } of ACCOUNTS) {
        await db.insertWithUUID('accounts', account);
        await db.insertPayee({
          id: `spike-transfer-${account.id}`,
          name: '',
          transfer_acct: account.id,
        });
      }
      await db.insertPayee({
        id: 'spike-starting-payee',
        name: 'Starting Balance',
      });
      for (const payee of newPayees) {
        await db.insertPayee({ id: payee.id, name: payee.name });
      }
      for (const { row: account } of ACCOUNTS) {
        await db.insertTransaction({
          id: `${account.id}-starting`,
          account: account.id,
          amount: 100000,
          category: account.offbudget ? null : 'spike-starting',
          payee: 'spike-starting-payee',
          date: '2024-09-27',
          cleared: true,
          starting_balance_flag: true,
        });
      }
      const now = Date.now();
      for (const [i, row] of ruled.entries()) {
        await db.insertTransaction({
          ...row,
          sort_order: now - i * 1024,
        });
      }
      builtAt = performance.now();
    });
    const appliedAt = performance.now();
    const buildMs = builtAt - batchStart;
    const applyMs = appliedAt - builtAt;

    // Work after the commit: budget months for two years, then the sheet
    const postStart = performance.now();
    await createAllBudgets();
    await sheet.waitOnSpreadsheet();
    const postMs = performance.now() - postStart;
    const monthCount = sheet.get().meta().createdMonths.size;

    const [{ count: messageCount }] = await db.all<{ count: number }>(
      'SELECT COUNT(*) AS count FROM messages_crdt',
    );
    const [{ count: transactionCount }] = await db.all<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions WHERE tombstone = 0',
    );

    const gateMs = rulesMs + buildMs + applyMs;
    report([
      ['rows', String(ROWS)],
      ['rules', '36'],
      ['rows a rule categorized', String(categorized)],
      ['runRules total', `${rulesMs.toFixed(0)} ms`],
      ['runRules per row', `${(rulesMs / ROWS).toFixed(2)} ms`],
      ['batch: build messages', `${buildMs.toFixed(0)} ms`],
      ['batch: applyMessages', `${applyMs.toFixed(0)} ms`],
      ['messages written', String(messageCount)],
      ['budget months after commit', String(monthCount)],
      ['after commit: budgets + sheet', `${postMs.toFixed(0)} ms`],
      ['gate: rules + batch', `${gateMs.toFixed(0)} ms (limit ${GATE_MS})`],
    ]);

    expect(transactionCount).toBe(ROWS + ACCOUNTS.length);
    expect(gateMs).toBeLessThan(GATE_MS);
  }, 300_000);
});
```

- [ ] **Step 2: Run it without the flag to verify it is skipped by default**

Run: `yarn workspace @actual-app/core run test:node src/server/bank-file-setup/create-cost.spike.test.ts`
Expected: `Tests  1 skipped (1)`, exit 0. This is what CI and `yarn test` will see.

- [ ] **Step 3: Run the measurement**

Run: `SETUP_SPIKE=1 yarn workspace @actual-app/core run test:node src/server/bank-file-setup/create-cost.spike.test.ts`
Expected: PASS, with a report on stderr like this one (from a run on a laptop that was busy with other work; five runs gave a gate total between 1.5 and 6.5 seconds, `applyMessages` being most of it):

```
Create cost spike (node backend)
  rows                           5000
  rules                          36
  rows a rule categorized        1866
  runRules total                 196 ms
  runRules per row               0.04 ms
  batch: build messages          213 ms
  batch: applyMessages           1214 ms
  messages written               47952
  budget months after commit     40
  after commit: budgets + sheet  9 ms
  gate: rules + batch            1623 ms (limit 10000)
```

Run it three times and keep the slowest report. If the test fails on `expect(gateMs).toBeLessThan(GATE_MS)`, stop here and report the three reports to the plan owner; do not start Task 5. The "after commit" figure is a lower bound: the app's spreadsheet computes some cells lazily after the handler returns.

- [ ] **Step 4 (manual, optional): Time the same rows on the web backend**

1. Write the rows as a CSV: `SETUP_SPIKE=1 SETUP_SPIKE_CSV=$PWD/spike-5000.csv yarn workspace @actual-app/core run test:node src/server/bank-file-setup/create-cost.spike.test.ts` (from the repository root, so `$PWD` is the root; the file is not committed).
2. `yarn start`, open http://localhost:3001, choose "Don't use a server", then "View demo".
3. Add a local account named Spike with a balance of 0, open it, click Import and choose `spike-5000.csv`. Map Date, Description (payee) and Amount, date format `yyyy-mm-dd`.
4. Open the browser's developer tools, Performance tab, start recording, click Import, and stop recording when the rows appear. Read the duration of the worker's activity.
5. Delete `spike-5000.csv`. Record the duration in the commit message next to the node report, or write "web not measured".

- [ ] **Step 5: Typecheck, lint and commit**

Run: `yarn typecheck` then `yarn lint:fix`. Both pass.

```bash
git add packages/loot-core/src/server/bank-file-setup/create-cost.spike.test.ts
git commit -m "[AI] Add a skipped spike that measures Create's cost at 5,000 rows" -m "<paste the slowest Step 3 report here, verbatim, plus the Step 4 browser duration or 'web not measured', and the gate result: under or over 10 s>"
```

The second `-m` is the measured output, pasted as printed; it is the record the gate decision rests on.

---

### Task 2: OFX statements and parsing from bytes

`ofx2json` returns one statement per `STMTTRNRS`, `CCSTMTTRNRS` or `INVSTMTTRNRS`, reading every message set, while its merged `transactions` keep today's code path untouched (card, then investment, then bank). `parseFile` becomes a wrapper over a new `parseFileContents(name, bytes, options)`, which routes `.qbo` to the OFX parser and decodes QIF bytes as UTF-8. The merged result is pinned by a snapshot recorded before any parser change.

**Files:**

- Modify: `packages/loot-core/src/server/transactions/import/ofx2json.ts:6-18` (types), insert before `:101` (`getAsArray`), `:186-189` (return value)
- Modify: `packages/loot-core/src/server/transactions/import/parse-file.ts:1-327` (whole file; every parser now takes bytes)
- Create: `packages/loot-core/src/mocks/files/two-statements.ofx`
- Create: `packages/loot-core/src/mocks/files/mixed-bank-card.ofx`
- Create: `packages/loot-core/src/mocks/files/data.qbo`
- Test: `packages/loot-core/src/server/transactions/import/parse-file-statements.test.ts` (new) and its snapshot `packages/loot-core/src/server/transactions/import/__snapshots__/parse-file-statements.test.ts.snap`
- Test: `packages/loot-core/src/server/transactions/import/ofx2json.test.ts:1,33` (import line; append after the last line)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces (from `ofx2json.ts`): `export type OFXTransaction`, `export type OFXStatement` exactly as in the contract, `OFXParseResult.statements: OFXStatement[]` in the order bank, credit card, investment, and `export function parseOfxAmount(amount: string): number | null`.
- Produces (from `parse-file.ts`): `export type StructuredTransaction` (now with `imported_id?: string`), `export type ParseError`, `export type ParsedStatement = Omit<OFXStatement, 'transactions'> & { transactions: StructuredTransaction[]; errors: ParseError[] }` (a statement's own invalid-amount errors, for the flow to show on that account), `ParseFileResult.statements?: ParsedStatement[]` (set for `.ofx`, `.qfx`, `.qbo` only), `export async function parseFileContents(name: string, bytes: Uint8Array, options?: ParseFileOptions): Promise<ParseFileResult>`. `parseFile(filepath, options)` keeps its signature. Task 3 builds `SetupStatement` from `ParsedStatement` (it converts `ledgerBalance` with `amountToInteger`); Task 7's `setup-parse-file` calls `parseFileContents`.

- [ ] **Step 1: Pin today's merged result before changing anything**

Create `packages/loot-core/src/server/transactions/import/parse-file-statements.test.ts` with only the pin. Do this before Steps 6 and 7: the snapshot must be recorded from the unchanged parsers.

```ts
import { parseFile } from './parse-file';
import type { ParseFileOptions } from './parse-file';

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
```

- [ ] **Step 2: Run it to record the baseline**

Run (with `CI` unset, so Vitest writes new snapshots): `yarn workspace @actual-app/core run test:node src/server/transactions/import/parse-file-statements.test.ts`
Expected: PASS, `22 passed`, `Snapshots  22 written`. The file `__snapshots__/parse-file-statements.test.ts.snap` now holds the merged `transactions` and `errors` of every existing fixture as today's code produces them.

- [ ] **Step 3: Add the fixtures**

`packages/loot-core/src/mocks/files/two-statements.ofx` (one bank message set, checking and savings statements):

```
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20260327120000[0:GMT]
<LANGUAGE>ENG
<FI>
<ORG>JPMorgan Chase Bank, N.A.
<FID>10898
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>322271627
<ACCTID>000000001234
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301120000[0:GMT]
<DTEND>20260325120000[0:GMT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260303120000[0:GMT]
<TRNAMT>-4.50
<FITID>CHK-20260303-001
<NAME>BLUE BOTTLE COFFEE
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260310120000[0:GMT]
<TRNAMT>-200.00
<FITID>CHK-20260310-001
<NAME>ONLINE TRANSFER TO SAV ...5678
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260315120000[0:GMT]
<TRNAMT>2410.55
<FITID>CHK-20260315-001
<NAME>ACME CORP PAYROLL
<MEMO>PPD ID 9999999999
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>3843.20
<DTASOF>20260325120000[0:GMT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
<STMTTRNRS>
<TRNUID>2
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>322271627
<ACCTID>000000005678
<ACCTTYPE>SAVINGS
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301120000[0:GMT]
<DTEND>20260325120000[0:GMT]
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260310120000[0:GMT]
<TRNAMT>200.00
<FITID>SAV-20260310-001
<NAME>ONLINE TRANSFER FROM CHK ...1234
</STMTTRN>
<STMTTRN>
<TRNTYPE>INT
<DTPOSTED>20260324120000[0:GMT]
<TRNAMT>1.07
<FITID>SAV-20260324-001
<NAME>INTEREST PAYMENT
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>5201.07
<DTASOF>20260325120000[0:GMT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
```

`packages/loot-core/src/mocks/files/mixed-bank-card.ofx` (a bank and a card message set; the card payment pairs with the checking payment):

```
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20260327120000[0:GMT]
<LANGUAGE>ENG
<FI>
<ORG>JPMorgan Chase Bank, N.A.
<FID>10898
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>322271627
<ACCTID>000000001234
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301120000[0:GMT]
<DTEND>20260325120000[0:GMT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260312120000[0:GMT]
<TRNAMT>-523.10
<FITID>CHK-20260312-001
<NAME>Payment to Chase card ending in 9876
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260318120000[0:GMT]
<TRNAMT>-61.40
<FITID>CHK-20260318-001
<NAME>CITY WATER UTILITY
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1843.20
<DTASOF>20260325120000[0:GMT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>2
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<CCSTMTRS>
<CURDEF>USD
<CCACCTFROM>
<ACCTID>4111111111119876
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301120000[0:GMT]
<DTEND>20260326120000[0:GMT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260305120000[0:GMT]
<TRNAMT>-42.17
<FITID>CARD-20260305-001
<NAME>TRADER JOE'S #552
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260314120000[0:GMT]
<TRNAMT>523.10
<FITID>CARD-20260314-001
<NAME>Payment Thank You-Mobile
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-1234.56
<DTASOF>20260326120000[0:GMT]
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>
```

`packages/loot-core/src/mocks/files/data.qbo` is a byte-for-byte copy of `data.ofx` (CRLF line endings, `INTU.BID` header lines as real QBO files have). Create it with `cp packages/loot-core/src/mocks/files/data.ofx packages/loot-core/src/mocks/files/data.qbo`. Its contents, shown with the carriage returns omitted:

```
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20190124212851.000[0:UTC]
<LANGUAGE>ENG
<DTACCTUP>20190124212851.000[0:UTC]
<FI>
<ORG>Bank of America
<FID>5959
</FI>
<INTU.BID>6526
<INTU.USERID>jlongster03
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>0
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>012345678
<ACCTID>123456789123
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20190119120000
<DTEND>20190124120000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190123120000
<TRNAMT>-30.00
<FITID>00092990122-30.00019012312798.01
<NAME>PATIENT FIRST TOKEN 01/22 PURCHA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190123120000
<TRNAMT>-3.77
<FITID>00092990121-3.77019012312828.01
<NAME>STARBUCKS STORE 07604 01/21 PURC
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190123120000
<TRNAMT>-9.62
<FITID>00092990121-9.62019012312831.78
<NAME>STARBUCKS STORE 07604 01/21 PURC
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190122120000
<TRNAMT>-115.99
<FITID>00090231800-115.99019012212841.40
<NAME>VERIZON DES:PAYMENTREC ID:XXXXX3
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190122120000
<TRNAMT>-10.34
<FITID>00092990120-10.34019012212957.39
<NAME>URBAN FARMHOUSE NO 2 01/19 PURCH
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190122120000
<TRNAMT>-22.53
<FITID>00092990120-22.53019012212967.73
<NAME>URBAN FARMHOUSE NO 2 01/19 PURCH
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190122120000
<TRNAMT>-108.71
<FITID>00092990119-108.71019012212990.26
<NAME>TMOBILE*AUTO PAY 01/19 PURCHASE
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190122120000
<TRNAMT>-25.00
<FITID>00092990118-25.00019012213098.97
<NAME>COUNTY WASTE 01/18 PURCHASE 804-
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190122120000
<TRNAMT>-32.38
<FITID>00092990118-32.38019012213123.97
<NAME>REGENCY MART CITGO 01/18 PURCHAS
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20190122120000
<TRNAMT>-6.07
<FITID>00092990117-6.07019012213156.35
<NAME>CHICK-FIL-A #01342 01/17 PURCHAS
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>12798.01
<DTASOF>20190124212851
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
```

- [ ] **Step 4: Write the failing tests**

In `parse-file-statements.test.ts`, replace the two import lines at the top with:

```ts
import * as nativeFs from 'fs';

import { parseFile, parseFileContents } from './parse-file';
import type { ParsedStatement, ParseFileOptions } from './parse-file';
```

and append after the `merged transactions are unchanged` block:

```ts
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
```

In `ofx2json.test.ts`, change line 1 to `import { html2Plain, ofx2json } from './ofx2json';` and append after line 33. This pins the investment-over-bank precedence of the merged list; it uses two `INVBANKTRAN` entries because the merged path (`ofx2json.ts:95`) calls `flatMap` on them and only handles a list.

```ts
describe('ofx2json statements', () => {
  // Investment and bank message sets in one file. Two INVBANKTRAN entries,
  // because the merged path only handles a list of them.
  const investmentAndBank = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><FI><ORG>Brokerage<FID>777</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>1<ACCTID>CHK1<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105<TRNAMT>-10.00<FITID>B1<NAME>BANK ROW</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>100.00<DTASOF>20260131</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><TRNUID>2<INVSTMTRS><DTASOF>20260131<CURDEF>USD<INVACCTFROM><BROKERID>broker.example<ACCTID>INV9</INVACCTFROM>
<INVTRANLIST><DTSTART>20260101<DTEND>20260130
<INVBANKTRAN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260110<TRNAMT>25.00<FITID>I1<NAME>DIVIDEND</STMTTRN><SUBACCTFUND>CASH</INVBANKTRAN>
<INVBANKTRAN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260120<TRNAMT>-5.00<FITID>I2<NAME>FEE</STMTTRN><SUBACCTFUND>CASH</INVBANKTRAN>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
</OFX>
`;

  test('reads every message set; the merged list keeps investment over bank', async () => {
    const { transactions, statements } = await ofx2json(investmentAndBank);

    expect(transactions.map(t => t.fitId)).toEqual(['I1', 'I2']);
    expect(
      statements.map(({ transactions, ...rest }) => ({
        ...rest,
        fitIds: transactions.map(t => t.fitId),
      })),
    ).toEqual([
      {
        kind: 'bank',
        org: 'Brokerage',
        fid: '777',
        bankId: '1',
        accountId: 'CHK1',
        accountType: 'CHECKING',
        start: '2026-01-01',
        end: '2026-01-31',
        ledgerBalance: 100,
        ledgerDate: '2026-01-31',
        fitIds: ['B1'],
      },
      {
        kind: 'investment',
        org: 'Brokerage',
        fid: '777',
        bankId: null,
        accountId: 'INV9',
        accountType: null,
        start: '2026-01-01',
        end: '2026-01-30',
        ledgerBalance: null,
        ledgerDate: null,
        fitIds: ['I1', 'I2'],
      },
    ]);
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `yarn workspace @actual-app/core run test:node src/server/transactions/import/parse-file-statements.test.ts src/server/transactions/import/ofx2json.test.ts`
Expected: FAIL. The `parseFileContents` tests fail with `parseFileContents is not a function`, the statements tests (including `an invalid amount is reported on its own statement`) with `expected undefined to deeply equal [...]`, and the new `ofx2json statements` test with `statements` undefined. The 22 pin tests still pass.

- [ ] **Step 6: Implement statements in `ofx2json.ts`**

Replace the two types at `ofx2json.ts:6-18` with the exported types, the new `OFXStatement`, and `parseOfxAmount` (moved verbatim from `parse-file.ts:12-46`):

```ts
export type OFXTransaction = {
  amount: string;
  fitId: string;
  name: string;
  date: string;
  memo: string;
  type: string;
};

export type OFXStatement = {
  kind: 'bank' | 'credit' | 'investment';
  org: string | null; // SIGNONMSGSRSV1.SONRS.FI.ORG
  fid: string | null; // SIGNONMSGSRSV1.SONRS.FI.FID
  bankId: string | null; // BANKACCTFROM.BANKID
  accountId: string | null; // BANKACCTFROM.ACCTID or CCACCTFROM.ACCTID
  accountType: string | null; // BANKACCTFROM.ACCTTYPE, e.g. 'CHECKING'
  start: string | null; // BANKTRANLIST.DTSTART as YYYY-MM-DD
  end: string | null; // BANKTRANLIST.DTEND as YYYY-MM-DD
  ledgerBalance: number | null; // LEDGERBAL.BALAMT, decimal
  ledgerDate: string | null; // LEDGERBAL.DTASOF as YYYY-MM-DD
  transactions: OFXTransaction[];
};

type OFXParseResult = {
  headers: Record<string, unknown>;
  transactions: OFXTransaction[];
  statements: OFXStatement[];
};

/**
 * Parse OFX amount strings to numbers.
 * Handles various OFX amount formats including currency symbols, parentheses, and multiple decimal places.
 * Returns null for invalid amounts instead of NaN.
 */
export function parseOfxAmount(amount: string): number | null {
  if (!amount || typeof amount !== 'string') {
    return null;
  }

  // Handle parentheses for negative amounts (e.g., "(30.00)" -> "-30.00")
  let cleaned = amount.trim();
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }

  // Remove currency symbols and other non-numeric characters except decimal point and minus sign
  cleaned = cleaned.replace(/[^\d.-]/g, '');

  // Handle multiple decimal points by keeping only the first one
  const decimalIndex = cleaned.indexOf('.');
  if (decimalIndex !== -1) {
    const beforeDecimal = cleaned.slice(0, decimalIndex);
    const afterDecimal = cleaned.slice(decimalIndex + 1).replace(/\./g, '');
    cleaned = beforeDecimal + '.' + afterDecimal;
  }

  // Ensure we have a valid number format
  if (!cleaned || cleaned === '-' || cleaned === '.') {
    return null;
  }

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}
```

Insert before `function getAsArray(value) {` (line 101):

```ts
// Every statement in every message set, in the order bank, credit card,
// investment. Unlike getStmtTrn, a file with both bank and card
// statements keeps both.
function getStatements(data): OFXStatement[] {
  const ofx = data?.['OFX'];
  const fi = ofx?.['SIGNONMSGSRSV1']?.['SONRS']?.['FI'];
  const org = ofxText(fi?.['ORG']);
  const fid = ofxText(fi?.['FID']);

  const bank = getAsArray(ofx?.['BANKMSGSRSV1']?.['STMTTRNRS']).map(s => {
    const stmtRs = s?.['STMTRS'];
    const tranList = stmtRs?.['BANKTRANLIST'];
    return makeStatement({
      kind: 'bank',
      org,
      fid,
      acctFrom: stmtRs?.['BANKACCTFROM'],
      tranList,
      ledger: stmtRs?.['LEDGERBAL'],
      stmtTrn: getAsArray(tranList?.['STMTTRN']),
    });
  });

  const credit = getAsArray(ofx?.['CREDITCARDMSGSRSV1']?.['CCSTMTTRNRS']).map(
    s => {
      const stmtRs = s?.['CCSTMTRS'];
      const tranList = stmtRs?.['BANKTRANLIST'];
      return makeStatement({
        kind: 'credit',
        org,
        fid,
        acctFrom: stmtRs?.['CCACCTFROM'],
        tranList,
        ledger: stmtRs?.['LEDGERBAL'],
        stmtTrn: getAsArray(tranList?.['STMTTRN']),
      });
    },
  );

  const investment = getAsArray(ofx?.['INVSTMTMSGSRSV1']?.['INVSTMTTRNRS']).map(
    s => {
      const stmtRs = s?.['INVSTMTRS'];
      const tranList = stmtRs?.['INVTRANLIST'];
      return makeStatement({
        kind: 'investment',
        org,
        fid,
        acctFrom: stmtRs?.['INVACCTFROM'],
        tranList,
        ledger: null,
        stmtTrn: getAsArray(tranList?.['INVBANKTRAN']).flatMap(t =>
          getAsArray(t?.['STMTTRN']),
        ),
      });
    },
  );

  return [...bank, ...credit, ...investment];
}

function makeStatement({
  kind,
  org,
  fid,
  acctFrom,
  tranList,
  ledger,
  stmtTrn,
}): OFXStatement {
  return {
    kind,
    org,
    fid,
    bankId: ofxText(acctFrom?.['BANKID']),
    accountId: ofxText(acctFrom?.['ACCTID']),
    accountType: ofxText(acctFrom?.['ACCTTYPE']),
    start: ofxDay(tranList?.['DTSTART']),
    end: ofxDay(tranList?.['DTEND']),
    ledgerBalance: parseOfxAmount(ledger?.['BALAMT']),
    ledgerDate: ofxDay(ledger?.['DTASOF']),
    transactions: stmtTrn.map(mapOfxTransaction),
  };
}

function ofxText(value): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

// OFX dates are YYYYMMDD, optionally followed by a time and a zone.
function ofxDay(value): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(ofxText(value) ?? '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
```

Replace the return value at lines 186-189 with:

```ts
return {
  headers,
  transactions: getStmtTrn(dataParsed).map(mapOfxTransaction),
  statements: getStatements(dataParsed),
};
```

`getStmtTrn` and `mapOfxTransaction` are not touched, so the merged list is computed exactly as before. `getStatements` wraps every value in `getAsArray`, so a single `INVBANKTRAN` works there even though it does not in the merged path.

- [ ] **Step 7: Implement `parseFileContents` in `parse-file.ts`**

Replace the whole file with the following. What changes: `parseOfxAmount` is imported from `ofx2json.ts`; `StructuredTransaction` is exported and gains `imported_id`; `ParsedStatement` and `ParseFileResult.statements` are added; `parseFile` checks the extension first (so `foo.txt` is still rejected without being read, as the existing extension test requires), reads the bytes and calls `parseFileContents`; each parser takes bytes; QIF bytes are decoded as UTF-8 (today's `fs.readFile(path)` decodes as UTF-8 too); OFX maps statement rows with the same function as the merged rows; the file-level `errors` are built from the merged list exactly as before, and each statement gets its own `errors` from its own rows.

```ts
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
```

- [ ] **Step 8: Run them to verify they pass, and that nothing else moved**

Run: `yarn workspace @actual-app/core run test:node src/server/transactions/import/`
Expected: PASS, 3 files, 90 tests. `parse-file.test.ts` passes with its existing snapshot file unchanged, and the 22 pin tests pass against the snapshot recorded in Step 2.

Run: `git status --short packages/loot-core/src/server/transactions/import/__snapshots__/`
Expected: only `?? .../parse-file-statements.test.ts.snap`; `parse-file.test.ts.snap` is not modified.

- [ ] **Step 9: Typecheck, lint and commit**

Run: `yarn typecheck` then `yarn lint:fix`. Both pass.

```bash
git add packages/loot-core/src/server/transactions/import/ofx2json.ts \
  packages/loot-core/src/server/transactions/import/ofx2json.test.ts \
  packages/loot-core/src/server/transactions/import/parse-file.ts \
  packages/loot-core/src/server/transactions/import/parse-file-statements.test.ts \
  packages/loot-core/src/server/transactions/import/__snapshots__/parse-file-statements.test.ts.snap \
  packages/loot-core/src/mocks/files/two-statements.ofx \
  packages/loot-core/src/mocks/files/mixed-bank-card.ofx \
  packages/loot-core/src/mocks/files/data.qbo
git commit -m "[AI] Return OFX statements and parse import files from their bytes"
```

---

### Task 3: The shared pure functions for the review

**Files:**

- Create: `packages/loot-core/src/shared/bank-file-setup.ts`
- Test: `packages/loot-core/src/shared/bank-file-setup.test.ts`

**Interfaces:**

- Consumes: `differenceInCalendarDays(a, b)` from `packages/loot-core/src/shared/months.ts:216-221` (imported as `import * as monthUtils from './months'`, as `shared/schedules.ts` does). Nothing from earlier tasks.
- Produces, exactly as the Interface Contract's `[Task 3]` block: the types `SetupAccountType`, `SetupRow`, `SetupStatement`, `SetupFile`, `SetupAccountDraft`, `KnownBalance`, `BalanceBlock`, `SkippedRow`, `TransferPair`, `ReviewAccount`, `Review`, and the functions `dedupeAcrossFiles(files)`, `knownBalance(account, kept, today)`, `startingBalance(rows, known)`, `findTransferPairs(accounts)`, `validateTransferPair(pair, rowsById)`, `buildReview(accounts, today)`. Clients import them as `@actual-app/core/shared/bank-file-setup` (the package's `./shared/*` export); server code as `#shared/bank-file-setup`.

The module is pure: no database, no `Date.now()`, and `today` is always passed in so the client and the server's re-check at Create agree. Amounts are integer cents; negative is money out. Fixtures are small and each expected number has its arithmetic in a comment.

Four red/green cycles: duplicates, balances, transfers, then the review that combines them. One commit at the end.

- [ ] **Step 1: Write the failing test for duplicates across files**

Create `packages/loot-core/src/shared/bank-file-setup.test.ts`. Review Focus 1 is pinned by the first two tests: two identical coffees in one file both stay, and only their copies in a second file are skipped.

```ts
import { dedupeAcrossFiles } from './bank-file-setup';
import type { SetupFile, SetupRow } from './bank-file-setup';

function row(
  fileId: string,
  index: number,
  date: string,
  amount: number,
  payeeName: string,
  importedId: string | null = null,
): SetupRow {
  return {
    id: `${fileId}:${index}`,
    fileId,
    date,
    amount,
    payeeName,
    importedPayee: payeeName,
    notes: null,
    importedId,
  };
}

function file(
  id: string,
  rows: SetupRow[],
  patch: Partial<SetupFile> = {},
): SetupFile {
  return {
    id,
    name: `${id}.csv`,
    format: 'csv',
    rows,
    statement: null,
    csvBalance: null,
    needsMapping: false,
    ...patch,
  };
}

function ids(rows: Array<{ id: string }>) {
  return rows.map(r => r.id);
}

describe('dedupeAcrossFiles', () => {
  // Review Focus 1
  test('keeps identical purchases within one file', () => {
    const coffees = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('a', 1, '2026-03-02', -450, 'Blue Bottle'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([coffees]);

    expect(ids(kept)).toEqual(['a:0', 'a:1']);
    expect(skipped).toEqual([]);
  });

  // Review Focus 1
  test('skips only the copies of them in a second file', () => {
    const a = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('a', 1, '2026-03-02', -450, 'Blue Bottle'),
      row('a', 2, '2026-03-03', -2000, 'Safeway'),
    ]);
    const b = file('b', [
      row('b', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('b', 1, '2026-03-02', -450, 'Blue Bottle'),
      row('b', 2, '2026-04-01', -150000, 'Rent'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0', 'a:1', 'a:2', 'b:2']);
    expect(skipped).toEqual([
      { row: b.rows[0], keptFromFileId: 'a' },
      { row: b.rows[1], keptFromFileId: 'a' },
    ]);
  });

  test('keeps the largest count of a purchase seen in any single file', () => {
    const a = file('a', [row('a', 0, '2026-03-02', -450, 'Blue Bottle')]);
    const b = file('b', [
      row('b', 0, '2026-03-02', -450, 'Blue Bottle'),
      row('b', 1, '2026-03-02', -450, 'Blue Bottle'),
    ]);
    const c = file('c', [row('c', 0, '2026-03-02', -450, 'Blue Bottle')]);

    const { kept, skipped } = dedupeAcrossFiles([a, b, c]);

    // Two copies at most in one file, so two are kept
    expect(ids(kept)).toEqual(['a:0', 'b:1']);
    expect(skipped).toEqual([
      { row: b.rows[0], keptFromFileId: 'a' },
      { row: c.rows[0], keptFromFileId: 'a' },
    ]);
  });

  test('matches on imported id even when the description differs', () => {
    const a = file('a', [
      row('a', 0, '2026-03-05', -20000, 'CHASE CREDIT CRD AUTOPAY', 'FIT1'),
    ]);
    const b = file('b', [
      row('b', 0, '2026-03-05', -20000, 'Chase autopay', 'FIT1'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0']);
    expect(skipped).toEqual([{ row: b.rows[0], keptFromFileId: 'a' }]);
  });

  test('keeps rows whose imported ids differ, even with the same date, amount and description', () => {
    const a = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle', 'FIT1'),
    ]);
    const b = file('b', [
      row('b', 0, '2026-03-02', -450, 'Blue Bottle', 'FIT2'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0', 'b:0']);
    expect(skipped).toEqual([]);
  });

  test('matches on date, amount and description when only one row has an imported id', () => {
    const ofx = file('a', [
      row('a', 0, '2026-03-02', -450, 'Blue Bottle', 'FIT1'),
    ]);
    const csv = file('b', [row('b', 0, '2026-03-02', -450, 'Blue Bottle')]);

    const { kept, skipped } = dedupeAcrossFiles([ofx, csv]);

    expect(ids(kept)).toEqual(['a:0']);
    expect(skipped).toEqual([{ row: csv.rows[0], keptFromFileId: 'a' }]);
  });

  test('keeps rows that differ in date, amount or description', () => {
    const a = file('a', [row('a', 0, '2026-03-02', -450, 'Blue Bottle')]);
    const b = file('b', [
      row('b', 0, '2026-03-03', -450, 'Blue Bottle'),
      row('b', 1, '2026-03-02', -451, 'Blue Bottle'),
      row('b', 2, '2026-03-02', -450, 'Blue Bottle Coffee'),
    ]);

    const { kept, skipped } = dedupeAcrossFiles([a, b]);

    expect(ids(kept)).toEqual(['a:0', 'b:0', 'b:1', 'b:2']);
    expect(skipped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: FAIL, `Error: Cannot find module './bank-file-setup'`.

- [ ] **Step 3: Implement the types and `dedupeAcrossFiles`**

Create `packages/loot-core/src/shared/bank-file-setup.ts` with the contract's types, `dedupeAcrossFiles`, and its helpers. A row matches only rows kept from earlier files, and each kept row can absorb one row per later file; a file's new rows are indexed after the whole file is read. That gives, for each date, amount and description, the largest count seen in any single file. An imported-id match wins first; two rows that both carry different imported ids never match on the key.

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing tests for the known and starting balances**

Replace the two import lines at the top of `packages/loot-core/src/shared/bank-file-setup.test.ts` with:

```ts
import {
  dedupeAcrossFiles,
  knownBalance,
  startingBalance,
} from './bank-file-setup';
import type {
  SetupAccountDraft,
  SetupFile,
  SetupRow,
  SetupStatement,
} from './bank-file-setup';
```

Add these helpers after the `file` helper:

```ts
const TODAY = '2026-09-27';

function statement(patch: Partial<SetupStatement>): SetupStatement {
  return {
    org: 'Chase',
    accountId: '1234',
    accountType: 'CHECKING',
    start: '2026-03-01',
    end: '2026-03-31',
    ledgerBalance: null,
    ledgerDate: null,
    ...patch,
  };
}

function account(
  id: string,
  files: SetupFile[],
  patch: Partial<SetupAccountDraft> = {},
): SetupAccountDraft {
  return {
    id,
    name: id,
    bank: 'Chase',
    type: 'checking',
    offbudget: false,
    files,
    entered: null,
    ...patch,
  };
}
```

Append at the end of the file. The third `knownBalance` test pins Review Focus 5: a ledger dated after its statement's end is not used, the block names both dates for the card's copy, and a balance the person then enters is dated on the end date.

```ts
describe('knownBalance', () => {
  const rows = [
    row('a', 0, '2026-03-02', -450, 'Blue Bottle'),
    row('a', 1, '2026-03-28', -2000, 'Safeway'),
  ];

  test('uses an OFX ledger balance dated on the statement end, before a CSV balance or an entered one', () => {
    const checking = account(
      'checking',
      [
        file('ofx', [], {
          format: 'ofx',
          statement: statement({
            ledgerBalance: 150000,
            ledgerDate: '2026-03-31',
          }),
        }),
        file('csv', [], {
          csvBalance: { date: '2026-03-30', amount: 99999 },
        }),
      ],
      { entered: 5000 },
    );

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'ledger',
      amount: 150000,
      date: '2026-03-31',
    });
  });

  test('uses the latest of several usable ledger balances', () => {
    const checking = account('checking', [
      file('feb', [], {
        format: 'ofx',
        statement: statement({
          start: '2026-02-01',
          end: '2026-02-28',
          ledgerBalance: 120000,
          ledgerDate: '2026-02-27',
        }),
      }),
      file('mar', [], {
        format: 'ofx',
        statement: statement({
          ledgerBalance: 150000,
          ledgerDate: '2026-03-31',
        }),
      }),
    ]);

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'ledger',
      amount: 150000,
      date: '2026-03-31',
    });
  });

  // Review Focus 5
  test('does not use a ledger balance dated after the statement end, and asks for the balance on the end date', () => {
    const stale = file('qfx', [], {
      format: 'qfx',
      statement: statement({ ledgerBalance: 150000, ledgerDate: '2026-04-02' }),
    });

    expect(knownBalance(account('checking', [stale]), rows, TODAY)).toEqual({
      kind: 'ledger-after-end',
      ledgerDate: '2026-04-02',
      end: '2026-03-31',
    });
    expect(
      knownBalance(
        account('checking', [stale], { entered: 90000 }),
        rows,
        TODAY,
      ),
    ).toEqual({ source: 'entered', amount: 90000, date: '2026-03-31' });
  });

  test('uses a CSV balance column when no ledger balance is usable', () => {
    const checking = account('checking', [
      file('qfx', [], {
        format: 'qfx',
        statement: statement({
          ledgerBalance: 150000,
          ledgerDate: '2026-04-02',
        }),
      }),
      file('csv', [], { csvBalance: { date: '2026-03-30', amount: 51234 } }),
    ]);

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'csv-balance',
      amount: 51234,
      date: '2026-03-30',
    });
  });

  test('dates an entered balance on the last transaction', () => {
    const checking = account('checking', [file('csv', rows)], {
      entered: 25000,
    });

    expect(knownBalance(checking, rows, TODAY)).toEqual({
      source: 'entered',
      amount: 25000,
      date: '2026-03-28',
    });
  });

  test('stores the amount owed on a card as a negative balance', () => {
    const card = account('card', [file('csv', rows)], {
      type: 'credit',
      entered: 112648,
    });

    expect(knownBalance(card, rows, TODAY)).toEqual({
      source: 'entered',
      amount: -112648,
      date: '2026-03-28',
    });
  });

  test('dates an entered balance today for an account with no files', () => {
    expect(
      knownBalance(account('cash', [], { entered: 2000 }), [], TODAY),
    ).toEqual({ source: 'entered', amount: 2000, date: TODAY });
  });

  test('asks for the balance on the last transaction date, or today with no files', () => {
    expect(
      knownBalance(account('checking', [file('csv', rows)]), rows, TODAY),
    ).toEqual({ kind: 'no-balance', asOf: '2026-03-28' });
    expect(knownBalance(account('cash', []), [], TODAY)).toEqual({
      kind: 'no-balance',
      asOf: TODAY,
    });
  });
});

describe('startingBalance', () => {
  test('subtracts the rows dated on or before the known date and dates it on the earliest row', () => {
    const rows = [
      row('a', 0, '2026-03-05', 100000, 'Payroll'),
      row('a', 1, '2026-03-01', -450, 'Blue Bottle'),
      row('a', 2, '2026-03-31', -2000, 'Safeway'),
      row('a', 3, '2026-04-02', -3000, 'Parking'),
    ];

    // 150000 - (100000 - 450 - 2000) = 52450; the April row is after the known date
    expect(
      startingBalance(rows, {
        source: 'ledger',
        amount: 150000,
        date: '2026-03-31',
      }),
    ).toEqual({ amount: 52450, date: '2026-03-01' });
  });

  test('works back from an amount owed on a card', () => {
    const rows = [
      row('s', 0, '2026-09-01', -5000, 'Coffee shop'),
      row('s', 1, '2026-09-20', 20000, 'Payment thank you'),
    ];

    // -112648 - (-5000 + 20000) = -127648, 1,276.48 owed on September 1
    expect(
      startingBalance(rows, {
        source: 'entered',
        amount: -112648,
        date: '2026-09-25',
      }),
    ).toEqual({ amount: -127648, date: '2026-09-01' });
  });

  test('is the known balance on its own date when there are no rows', () => {
    expect(
      startingBalance([], { source: 'entered', amount: 2000, date: TODAY }),
    ).toEqual({ amount: 2000, date: TODAY });
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: FAIL, the 7 duplicate tests pass and the 11 new ones fail with `TypeError: knownBalance is not a function` or `TypeError: startingBalance is not a function`.

- [ ] **Step 7: Implement `knownBalance` and `startingBalance`**

In `packages/loot-core/src/shared/bank-file-setup.ts`, add after `dedupeAcrossFiles`:

```ts
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
```

Add at the end of the file, with the other helpers:

```ts
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
```

- [ ] **Step 8: Run them to verify they pass**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 9: Write the failing tests for transfer pairs**

Replace the import lines at the top of `packages/loot-core/src/shared/bank-file-setup.test.ts` with:

```ts
import {
  dedupeAcrossFiles,
  findTransferPairs,
  knownBalance,
  startingBalance,
  validateTransferPair,
} from './bank-file-setup';
import type {
  SetupAccountDraft,
  SetupFile,
  SetupRow,
  SetupStatement,
} from './bank-file-setup';
```

Append at the end of the file. The `validateTransferPair` tests marked Review Focus 2 pin the stale-answer case at this layer: a confirmed pair whose file or account was removed, or whose amounts changed after a CSV remap, no longer validates. (Task 7 pins the server's rejection and Task 10 the reducer.)

```ts
describe('findTransferPairs', () => {
  test('pairs money leaving one account with the same amount arriving in another', () => {
    const pairs = findTransferPairs([
      {
        draftId: 'checking',
        rows: [row('c', 0, '2026-03-05', -20000, 'Payment to Sapphire')],
      },
      {
        draftId: 'card',
        rows: [row('s', 0, '2026-03-07', 20000, 'Payment thank you')],
      },
    ]);

    expect(pairs).toEqual([{ outRowId: 'c:0', inRowId: 's:0' }]);
  });

  test('pairs rows 5 days apart but not 6', () => {
    const accounts = (inDate: string) => [
      { draftId: 'checking', rows: [row('c', 0, '2026-03-01', -20000, 'Out')] },
      { draftId: 'card', rows: [row('s', 0, inDate, 20000, 'In')] },
    ];

    expect(findTransferPairs(accounts('2026-03-06'))).toEqual([
      { outRowId: 'c:0', inRowId: 's:0' },
    ]);
    expect(findTransferPairs(accounts('2026-03-07'))).toEqual([]);
  });

  test('ignores rows in the same account, with the same sign, or with different amounts', () => {
    expect(
      findTransferPairs([
        {
          // Opposite signs, but in one account
          draftId: 'checking',
          rows: [
            row('c', 0, '2026-03-05', -500, 'Out'),
            row('c', 1, '2026-03-05', 500, 'Refund'),
          ],
        },
        {
          draftId: 'card',
          rows: [
            // One cent more than c:0
            row('s', 0, '2026-03-05', 501, 'Not quite'),
            row('s', 1, '2026-03-05', -700, 'Out'),
          ],
        },
        {
          // Same sign as s:1
          draftId: 'savings',
          rows: [row('v', 0, '2026-03-05', -700, 'Also out')],
        },
      ]),
    ).toEqual([]);
  });

  test('gives each row at most one pair, taking the closest date', () => {
    const pairs = findTransferPairs([
      {
        draftId: 'checking',
        rows: [
          row('c', 0, '2026-03-10', -10000, 'Out'),
          row('c', 1, '2026-03-12', -10000, 'Out'),
        ],
      },
      { draftId: 'card', rows: [row('s', 0, '2026-03-08', 10000, 'In')] },
      { draftId: 'savings', rows: [row('v', 0, '2026-03-11', 10000, 'In')] },
    ]);

    // c:0 takes v:0 (1 day, closer than s:0 at 2); c:1 is left with s:0 (4 days)
    expect(pairs).toEqual([
      { outRowId: 'c:0', inRowId: 'v:0' },
      { outRowId: 'c:1', inRowId: 's:0' },
    ]);
  });

  test('is deterministic: earlier out-rows choose first and equal distances go to the lower id', () => {
    const accounts = [
      { draftId: 'a', rows: [row('a', 0, '2026-03-08', -10000, 'Out')] },
      { draftId: 'b', rows: [row('b', 0, '2026-03-10', -10000, 'Out')] },
      {
        draftId: 'c',
        rows: [
          row('c', 0, '2026-03-10', 10000, 'In'),
          row('c', 1, '2026-03-06', 10000, 'In'),
        ],
      },
    ];

    // a:0 goes first; c:0 and c:1 are both 2 days away, so it takes c:0.
    // b:0 would have matched c:0 on the same day, but c:0 is taken; c:1 is 4 days away.
    const expected = [
      { outRowId: 'a:0', inRowId: 'c:0' },
      { outRowId: 'b:0', inRowId: 'c:1' },
    ];
    expect(findTransferPairs(accounts)).toEqual(expected);
    expect(findTransferPairs([...accounts].reverse())).toEqual(expected);
  });
});

describe('validateTransferPair', () => {
  const out = {
    draftId: 'checking',
    row: row('c', 0, '2026-03-05', -20000, 'Out'),
  };
  const into = { draftId: 'card', row: row('s', 0, '2026-03-07', 20000, 'In') };
  const pair = { outRowId: 'c:0', inRowId: 's:0' };

  function rowsById(...entries: Array<{ draftId: string; row: SetupRow }>) {
    return new Map(entries.map(entry => [entry.row.id, entry]));
  }

  test('accepts a pair that still matches', () => {
    expect(validateTransferPair(pair, rowsById(out, into))).toBe(true);
  });

  // Review Focus 2
  test('rejects a pair whose file or account was removed', () => {
    expect(validateTransferPair(pair, rowsById(out))).toBe(false);
    expect(validateTransferPair(pair, rowsById(into))).toBe(false);
  });

  // Review Focus 2
  test('rejects a pair whose amounts changed after the CSV was remapped', () => {
    const remapped = { ...into, row: { ...into.row, amount: 19999 } };
    const flipped = { ...into, row: { ...into.row, amount: -20000 } };

    expect(validateTransferPair(pair, rowsById(out, remapped))).toBe(false);
    expect(validateTransferPair(pair, rowsById(out, flipped))).toBe(false);
  });

  test('rejects a pair in one account, more than 5 days apart, or with its sides swapped', () => {
    const sameAccount = { ...into, draftId: 'checking' };
    const late = { ...into, row: { ...into.row, date: '2026-03-11' } };

    expect(validateTransferPair(pair, rowsById(out, sameAccount))).toBe(false);
    expect(validateTransferPair(pair, rowsById(out, late))).toBe(false);
    expect(
      validateTransferPair(
        { outRowId: 's:0', inRowId: 'c:0' },
        rowsById(out, into),
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 10: Run them to verify they fail**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: FAIL, 18 pass and the 9 new tests fail with `TypeError: findTransferPairs is not a function` or `TypeError: validateTransferPair is not a function`.

- [ ] **Step 11: Implement `findTransferPairs` and `validateTransferPair`**

In `packages/loot-core/src/shared/bank-file-setup.ts`, add as the first line of the file:

```ts
import * as monthUtils from './months';
```

Add after the `Review` type:

```ts
const TRANSFER_WINDOW_DAYS = 5;

type LocatedRow = { draftId: string; row: SetupRow };
```

Add after `startingBalance`. In-rows are indexed by amount so a 5,000-row review compares each out-row only with in-rows of the same amount.

```ts
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
```

Add at the end of the file, with the other helpers:

```ts
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
```

- [ ] **Step 12: Run them to verify they pass**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: PASS, 27 tests.

- [ ] **Step 13: Write the failing tests for the review**

Replace the import lines at the top of `packages/loot-core/src/shared/bank-file-setup.test.ts` with:

```ts
import {
  buildReview,
  dedupeAcrossFiles,
  findTransferPairs,
  knownBalance,
  startingBalance,
  validateTransferPair,
} from './bank-file-setup';
import type {
  SetupAccountDraft,
  SetupFile,
  SetupRow,
  SetupStatement,
} from './bank-file-setup';
```

Append at the end of the file. The first test combines the pieces: an OFX statement and an overlapping CSV in one account (one skipped row), a card with an entered amount owed, and the checking account's card payment found as a likely transfer.

```ts
describe('buildReview', () => {
  // Checking: an OFX statement and an overlapping CSV. Card: one CSV and an
  // entered amount owed.
  const jan = file(
    'j',
    [
      row('j', 0, '2026-03-20', 100000, 'Payroll', 'FIT3'),
      row('j', 1, '2026-03-02', -450, 'Blue Bottle', 'FIT1'),
      row('j', 2, '2026-03-05', -20000, 'Payment to Sapphire', 'FIT2'),
    ],
    {
      format: 'ofx',
      statement: statement({ ledgerBalance: 150000, ledgerDate: '2026-03-31' }),
    },
  );
  const recent = file('k', [
    row('k', 0, '2026-03-20', 100000, 'Payroll'),
    row('k', 1, '2026-04-02', -3000, 'Parking'),
  ]);
  const cardFile = file('s', [
    row('s', 0, '2026-03-06', 20000, 'Payment thank you'),
    row('s', 1, '2026-03-15', -2500, 'Coffee shop'),
  ]);

  test('computes each account and the likely transfers', () => {
    const review = buildReview(
      [
        account('checking', [jan, recent]),
        account('card', [cardFile], { type: 'credit', entered: 5000 }),
      ],
      TODAY,
    );

    expect(review.accounts[0]).toEqual({
      draftId: 'checking',
      rows: [jan.rows[1], jan.rows[2], jan.rows[0], recent.rows[1]],
      skipped: [{ row: recent.rows[0], keptFromFileId: 'j' }],
      from: '2026-03-02',
      to: '2026-04-02',
      known: { source: 'ledger', amount: 150000, date: '2026-03-31' },
      // 150000 - (-450 - 20000 + 100000) = 70450
      starting: { amount: 70450, date: '2026-03-02' },
      // 70450 + 79550 - 3000
      ending: 147000,
      block: null,
    });
    expect(review.accounts[1]).toEqual({
      draftId: 'card',
      rows: cardFile.rows,
      skipped: [],
      from: '2026-03-06',
      to: '2026-03-15',
      known: { source: 'entered', amount: -5000, date: '2026-03-15' },
      // -5000 - (20000 - 2500) = -22500, 225.00 owed
      starting: { amount: -22500, date: '2026-03-06' },
      ending: -5000,
      block: null,
    });
    expect(review.candidatePairs).toEqual([
      { outRowId: 'j:2', inRowId: 's:0' },
    ]);
    expect(review.transactionCount).toBe(6);
    expect(review.ready).toBe(true);
  });

  test('blocks an account with an unmapped file or no balance', () => {
    const unmapped = file('u', [], { needsMapping: true });
    const review = buildReview(
      [
        account('checking', [jan, unmapped]),
        account('card', [cardFile], { type: 'credit' }),
      ],
      TODAY,
    );

    expect(review.accounts[0]).toMatchObject({
      block: 'needs-columns',
      known: null,
      starting: null,
      ending: null,
    });
    expect(review.accounts[1]).toMatchObject({
      block: { kind: 'no-balance', asOf: '2026-03-15' },
      known: null,
      starting: null,
      ending: null,
    });
    expect(review.transactionCount).toBe(5);
    expect(review.ready).toBe(false);
  });

  test('creates an account with no files at the entered balance, dated today', () => {
    const review = buildReview(
      [account('cash', [], { type: 'other', entered: 2000 })],
      TODAY,
    );

    expect(review.accounts[0]).toEqual({
      draftId: 'cash',
      rows: [],
      skipped: [],
      from: null,
      to: null,
      known: { source: 'entered', amount: 2000, date: TODAY },
      starting: { amount: 2000, date: TODAY },
      ending: 2000,
      block: null,
    });
    expect(review.candidatePairs).toEqual([]);
    expect(review.ready).toBe(true);
  });
});
```

- [ ] **Step 14: Run them to verify they fail**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: FAIL, 27 pass and the 3 new tests fail with `TypeError: buildReview is not a function`.

- [ ] **Step 15: Implement `buildReview`**

In `packages/loot-core/src/shared/bank-file-setup.ts`, add after `validateTransferPair`:

```ts
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
```

- [ ] **Step 16: Run them to verify they pass**

Run: `yarn workspace @actual-app/core run test:node src/shared/bank-file-setup.test.ts`
Expected: PASS, 30 tests.

- [ ] **Step 17: Typecheck, lint and commit**

Run: `yarn typecheck`
Expected: no errors. The new files are strict; do not add `// @ts-strict-ignore`.

Run: `yarn lint:fix`
Expected: no remaining errors in the two new files.

```bash
git add packages/loot-core/src/shared/bank-file-setup.ts packages/loot-core/src/shared/bank-file-setup.test.ts
git commit -m "[AI] Add the shared functions for duplicates, balances and transfers in bank file setup"
```

---

### Task 4: `runRules` option `resolvePayeeNames`

`runRules` inserts a payee when a rule sets a payee name that does not exist (`resolvePayeeNameForRules`, `transaction-rules.ts:1190-1207`), which would commit outside Create's batch. With `resolvePayeeNames: false` it still uses an existing payee found by name, but leaves a new name as `payee: 'new'` with `payee_name` and writes nothing. The default keeps today's behavior for every existing caller. This is Review Focus 3's first half; Task 6 pins the second (no payee after a failed Create).

**Files:**

- Modify: `packages/loot-core/src/server/transactions/transaction-rules.ts:321-324` (signature), `:392`, `:410`, `:426`, `:434` (pass the option), `:1190-1207` (`resolvePayeeNameForRules`), `:1238-1244` (`finalizeTransactionForRules`)
- Test: `packages/loot-core/src/server/transactions/transaction-rules.test.ts` (append after line 1467)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `runRules(trans, accounts: Map<string, db.DbAccount> | null = null, { resolvePayeeNames = true }: { resolvePayeeNames?: boolean } = {})`. With false, the returned transaction has either an existing payee id (and no `payee_name`) or `payee: 'new'` with `payee_name` set; no row is written to `payees` or `payee_mapping`. `finalizeTransactionForRules(trans, { resolvePayeeNames })` gains the same option. Task 5 and Task 6 call `runRules(row, accountsMap, { resolvePayeeNames: false })` and resolve `'new'` against their in-memory payee map.

- [ ] **Step 1: Write the failing test**

Append to `transaction-rules.test.ts` (its imports already include `db`, `insertRule`, `loadRules` and `runRules`; the file's `beforeEach` gives an empty database):

```ts
describe('runRules resolvePayeeNames', () => {
  async function payeeNames() {
    const rows = await db.all<{ name: string }>(
      'SELECT name FROM payees WHERE tombstone = 0 AND name IS NOT NULL ORDER BY name',
    );
    return rows.map(row => row.name);
  }

  beforeEach(async () => {
    await loadRules();
    await db.insertAccount({ id: 'checking', name: 'Checking' });
    await db.insertPayee({ id: 'coffee_id', name: 'Blue Bottle Coffee' });
    // Renames to a payee that exists
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'contains', field: 'imported_payee', value: 'SQ *BLUE' },
      ],
      actions: [
        { op: 'set', field: 'payee_name', value: 'Blue Bottle Coffee' },
      ],
    });
    // Renames to a payee that does not exist yet
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'contains', field: 'imported_payee', value: 'SQ *RITUAL' },
      ],
      actions: [{ op: 'set', field: 'payee_name', value: 'Ritual Roasters' }],
    });
    // Chained on the renamed payee's id
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'coffee_id' }],
      actions: [{ op: 'set', field: 'notes', value: 'coffee' }],
    });
  });

  function ritual() {
    return {
      account: 'checking',
      date: '2026-03-05',
      amount: -450,
      imported_payee: 'SQ *RITUAL COFFEE',
      payee: null,
      category: null,
    };
  }

  test('by default a new payee name is inserted and resolved', async () => {
    const transaction = await runRules(ritual());

    const inserted = await db.getPayeeByName('Ritual Roasters');
    expect(inserted).not.toBeNull();
    expect(transaction.payee).toBe(inserted.id);
    expect('payee_name' in transaction).toBe(false);
    expect(await payeeNames()).toEqual([
      'Blue Bottle Coffee',
      'Ritual Roasters',
    ]);
  });

  test('false leaves a new payee name unresolved and writes nothing', async () => {
    const payeesBefore = await db.all('SELECT * FROM payees');
    const mappingsBefore = await db.all('SELECT * FROM payee_mapping');

    const transaction = await runRules(ritual(), null, {
      resolvePayeeNames: false,
    });

    expect(transaction.payee).toBe('new');
    expect(transaction).toMatchObject({ payee_name: 'Ritual Roasters' });
    expect(await db.all('SELECT * FROM payees')).toEqual(payeesBefore);
    expect(await db.all('SELECT * FROM payee_mapping')).toEqual(mappingsBefore);
  });

  test('false still resolves a name to an existing payee, so chained rules run', async () => {
    const transaction = await runRules(
      { ...ritual(), imported_payee: 'SQ *BLUE BOTTLE 0042' },
      null,
      { resolvePayeeNames: false },
    );

    expect(transaction.payee).toBe('coffee_id');
    expect(transaction.notes).toBe('coffee');
    expect('payee_name' in transaction).toBe(false);
    expect(await payeeNames()).toEqual(['Blue Bottle Coffee']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @actual-app/core run test:node src/server/transactions/transaction-rules.test.ts -t resolvePayeeNames`
Expected: FAIL, 1 failed and 2 passed: `false leaves a new payee name unresolved and writes nothing` with `Expected: "new"`, `Received: "id5"` (the option is ignored and a payee is inserted). The other two pass on today's code and pin the default and the existing-payee case.

- [ ] **Step 3: Implement**

Replace the signature at lines 321-324:

```ts
export async function runRules(
  trans,
  accounts: Map<string, db.DbAccount> | null = null,
  { resolvePayeeNames = true }: { resolvePayeeNames?: boolean } = {},
) {
```

At lines 392, 410 and 426, replace `await resolvePayeeNameForRules(finalTrans);` with:

```ts
await resolvePayeeNameForRules(finalTrans, { resolvePayeeNames });
```

At line 434, replace `return await finalizeTransactionForRules(finalTrans);` with:

```ts
return await finalizeTransactionForRules(finalTrans, { resolvePayeeNames });
```

Replace `resolvePayeeNameForRules` at lines 1190-1207 with:

```ts
/**
 * A rule that sets a payee name leaves `payee: 'new'` with `payee_name`.
 * Resolve it to an existing payee by name, or insert one. With
 * `resolvePayeeNames` false, an existing payee is still used, but a new
 * name is left as `payee: 'new'` with `payee_name` and nothing is written,
 * so a caller that batches its own writes can create the payee itself.
 */
async function resolvePayeeNameForRules(
  trans: TransactionEntity | TransactionForRules,
  { resolvePayeeNames = true }: { resolvePayeeNames?: boolean } = {},
): Promise<void> {
  if (!('payee_name' in trans) || trans.payee !== 'new') {
    return;
  }

  if (trans.payee_name) {
    let payee_id = (await getPayeeByName(trans.payee_name))?.id;
    if (payee_id == null && !resolvePayeeNames) {
      return;
    }
    payee_id ??= await insertPayee({
      name: trans.payee_name,
    });

    trans.payee = payee_id;
  } else {
    trans.payee = null;
  }
}
```

Replace the start of `finalizeTransactionForRules` at lines 1238-1244 (the signature and the `payee_name` block; the rest of the function is unchanged) with:

```ts
export async function finalizeTransactionForRules(
  trans: TransactionEntity | TransactionForRules,
  { resolvePayeeNames = true }: { resolvePayeeNames?: boolean } = {},
): Promise<TransactionEntity> {
  if ('payee_name' in trans) {
    await resolvePayeeNameForRules(trans, { resolvePayeeNames });
    // An unresolved name stays for the caller; it is the only record of it
    if (trans.payee !== 'new') {
      delete trans.payee_name;
    }
  }
```

With the default, `resolvePayeeNameForRules` always leaves an id or null, never `'new'`, so `payee_name` is deleted exactly as before.

- [ ] **Step 4: Run it to verify it passes, with the callers' tests**

Run: `yarn workspace @actual-app/core run test:node src/server/transactions/transaction-rules.test.ts src/server/rules src/server/accounts`
Expected: PASS (37 tests in `transaction-rules.test.ts`; the rules and accounts suites unchanged). The `stderr` lines about formula errors are printed by existing tests that expect them.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `yarn typecheck` then `yarn lint:fix`. Both pass.

```bash
git add packages/loot-core/src/server/transactions/transaction-rules.ts \
  packages/loot-core/src/server/transactions/transaction-rules.test.ts
git commit -m "[AI] Let runRules leave a new payee name unresolved without writing"
```

---

### Task 5: planCreate, part 1: accounts, payees, starting balances and imported rows

**Files:**

- Create: `packages/loot-core/src/server/bank-file-setup/plan-create.ts`
- Modify: `packages/loot-core/src/server/accounts/payees.ts:18-35` (extract `getStartingBalanceCategory`)
- Modify: `packages/loot-core/src/server/accounts/sync.ts:416-483` (extract `normalizeImportedPayeeName`)
- Test: `packages/loot-core/src/server/bank-file-setup/plan-create.test.ts`

**Interfaces:**

- Consumes (Task 3, `#shared/bank-file-setup`): `buildReview(accounts, today): Review`, `validateTransferPair(pair, rowsById): boolean`, types `SetupAccountDraft`, `SetupRow`, `TransferPair`, `Review`, `ReviewAccount`. Per `task-03.md`, `review.accounts[i]` is the review of `accounts[i]`. Its `rows` are the kept rows sorted by date, with same-day rows in file order. `starting` is null only when `block` is not null.
- Consumes (existing): `shoveSortOrders` and `TRANSACTION_SORT_INCREMENT` from `server/db/sort.ts`, and `db.all`, `db.first`.
- Produces: `SetupCreateInput`, `CreatePlan`, `PlannedPayee`, `SetupValidationError`, `planCreate(input): Promise<CreatePlan>`. After this task the plan has no rules, splits or transfers. Also `normalizeImportedPayeeName(payeeName, normalization)` and `getStartingBalanceCategory()`.

`planCreate` reads the database and never writes to it. Each field it sets is copied from the write path that sets it today, and the comment beside each field names that path. The plan uses only one fixed value that is not in the review: `Date.now()`, for transaction sort orders.

- [ ] **Step 1: Write the failing tests**

Create `packages/loot-core/src/server/bank-file-setup/plan-create.test.ts`. The balances come from Task 3's rules. With no statement and no CSV balance, an entered balance is dated on the last kept row. A credit card's entered amount is what is owed, stored as a negative.

```ts
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { loadRules } from '#server/transactions/transaction-rules';
import type { SetupAccountDraft, SetupRow } from '#shared/bank-file-setup';

import { planCreate, SetupValidationError } from './plan-create';
import type { CreatePlan, SetupCreateInput } from './plan-create';

const TODAY = '2026-02-01';
// Date.now() is fixed at 123456789 in tests (src/mocks/setup.ts)
const NOW = 123456789;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'starting',
    name: 'Starting Balances',
    cat_group: 'income',
    is_income: 1,
  });
  await db.insertCategoryGroup({ id: 'spending', name: 'Spending' });
  await db.insertCategory({
    id: 'groceries',
    name: 'Groceries',
    cat_group: 'spending',
  });
  await db.insertCategory({
    id: 'household',
    name: 'Household',
    cat_group: 'spending',
  });
  await db.insertCategory({
    id: 'investing',
    name: 'Investing',
    cat_group: 'spending',
  });
});

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
    importedId: `${fileId}-${index}`,
  };
}

function account(
  id: string,
  name: string,
  fileId: string,
  rows: SetupRow[],
  patch: Partial<SetupAccountDraft> = {},
): SetupAccountDraft {
  return {
    id,
    name,
    bank: 'Chase',
    type: 'checking',
    offbudget: false,
    entered: null,
    files:
      rows.length === 0
        ? []
        : [
            {
              id: fileId,
              name: `${fileId}.qfx`,
              format: 'qfx',
              rows,
              statement: null,
              csvBalance: null,
              needsMapping: false,
            },
          ],
    ...patch,
  };
}

// Known balance 250000 on 2026-01-10, the last row, so the starting
// balance is 250000 - (-450 + 200000) = 50450 on 2026-01-05
function checking(extraRows: SetupRow[] = []) {
  return account(
    'd-checking',
    'Chase Checking',
    'f-checking',
    [
      row('f-checking', 0, '2026-01-05', -450, 'COFFEE SHOP'),
      row('f-checking', 1, '2026-01-10', 200000, 'ACME PAYROLL'),
      ...extraRows,
    ],
    { entered: 250000 },
  );
}

// 10000 owed on 2026-01-07 is stored as -10000, so the starting
// balance is -10000 - (-2500) = -7500 on 2026-01-07
function card(extraRows: SetupRow[] = []) {
  return account(
    'd-card',
    'Chase Card',
    'f-card',
    [row('f-card', 0, '2026-01-07', -2500, 'GROCER'), ...extraRows],
    { type: 'credit', entered: 10000 },
  );
}

function input(
  accounts: SetupAccountDraft[],
  confirmedPairs: SetupCreateInput['confirmedPairs'] = [],
): SetupCreateInput {
  return { accounts, confirmedPairs, today: TODAY };
}

function byImportedId(plan: CreatePlan, importedId: string) {
  const found = plan.transactions.find(t => t.imported_id === importedId);
  if (!found) {
    throw new Error(`No planned transaction with imported_id ${importedId}`);
  }
  return found;
}

function payeeIdByName(plan: CreatePlan, name: string) {
  const found = plan.payees.find(payee => payee.name === name);
  if (!found) {
    throw new Error(`No planned payee named ${name}`);
  }
  return found.id;
}

function createdPayeeNames(plan: CreatePlan) {
  return plan.payees
    .filter(payee => payee.transfer_acct === undefined)
    .map(payee => payee.name)
    .sort();
}

async function countRows(table: string) {
  const result = await db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  return result?.count ?? 0;
}

describe('planCreate', () => {
  test('plans two new accounts in an empty budget', async () => {
    const plan = await planCreate(input([checking(), card()]));

    expect(plan.accounts).toEqual([
      {
        id: expect.any(String),
        name: 'Chase Checking',
        offbudget: 0,
        closed: 0,
        sort_order: 16384,
        account_group_id: null,
      },
      {
        id: expect.any(String),
        name: 'Chase Card',
        offbudget: 0,
        closed: 0,
        sort_order: 32768,
        account_group_id: null,
      },
    ]);
    const checkingId = plan.accounts[0].id;
    const cardId = plan.accounts[1].id;
    expect(plan.accountIdByDraftId).toEqual({
      'd-checking': checkingId,
      'd-card': cardId,
    });

    expect(plan.payees.filter(p => p.transfer_acct !== undefined)).toEqual([
      { id: expect.any(String), name: '', transfer_acct: checkingId },
      { id: expect.any(String), name: '', transfer_acct: cardId },
    ]);
    expect(createdPayeeNames(plan)).toEqual([
      'Acme Payroll',
      'Coffee Shop',
      'Grocer',
      'Starting Balance',
    ]);

    const startingPayee = payeeIdByName(plan, 'Starting Balance');
    expect(plan.transactions).toMatchObject([
      {
        account: checkingId,
        amount: 50450,
        date: '2026-01-05',
        payee: startingPayee,
        category: 'starting',
        cleared: true,
        starting_balance_flag: true,
      },
      {
        account: checkingId,
        date: '2026-01-05',
        amount: -450,
        payee: payeeIdByName(plan, 'Coffee Shop'),
        imported_payee: 'COFFEE SHOP',
        imported_id: 'f-checking-0',
        notes: null,
        category: null,
        cleared: true,
        sort_order: NOW,
      },
      {
        account: checkingId,
        date: '2026-01-10',
        amount: 200000,
        payee: payeeIdByName(plan, 'Acme Payroll'),
        imported_payee: 'ACME PAYROLL',
        imported_id: 'f-checking-1',
        category: null,
        cleared: true,
        sort_order: NOW - 1024,
      },
      {
        account: cardId,
        amount: -7500,
        date: '2026-01-07',
        payee: startingPayee,
        category: 'starting',
        starting_balance_flag: true,
      },
      {
        account: cardId,
        amount: -2500,
        payee: payeeIdByName(plan, 'Grocer'),
        imported_id: 'f-card-0',
        sort_order: NOW,
      },
    ]);
    expect(new Set(plan.transactions.map(t => t.id)).size).toBe(5);
    expect(plan.transactionCount).toBe(3);
  });

  test('reuses existing payees by name instead of planning duplicates', async () => {
    await db.insertPayee({ id: 'coffee', name: 'Coffee Shop' });
    await db.insertPayee({ id: 'sb', name: 'Starting Balance' });

    const plan = await planCreate(input([checking()]));

    expect(byImportedId(plan, 'f-checking-0').payee).toBe('coffee');
    expect(
      plan.transactions.find(t => t.starting_balance_flag === true)?.payee,
    ).toBe('sb');
    expect(createdPayeeNames(plan)).toEqual(['Acme Payroll']);
  });

  test('places off-budget accounts after existing off-budget accounts, with no categories', async () => {
    await db.insertAccount({ id: 'old-checking', name: 'Old Checking' });
    await db.insertAccount({
      id: 'old-brokerage',
      name: 'Old Brokerage',
      offbudget: 1,
    });
    // 500000 on 2026-01-20: starting balance 500000 - 10000 = 490000
    const brokerage = account(
      'd-brokerage',
      'Brokerage',
      'f-brokerage',
      [row('f-brokerage', 0, '2026-01-20', 10000, 'DIVIDEND')],
      { type: 'other', offbudget: true, entered: 500000 },
    );
    // No files and a zero balance: an account and no transactions
    const loan = account('d-loan', 'Car Loan', 'f-loan', [], {
      type: 'other',
      offbudget: true,
      entered: 0,
    });

    const plan = await planCreate(input([brokerage, checking(), loan]));

    expect(plan.accounts).toMatchObject([
      { name: 'Brokerage', offbudget: 1, sort_order: 32768 },
      { name: 'Chase Checking', offbudget: 0, sort_order: 32768 },
      { name: 'Car Loan', offbudget: 1, sort_order: 49152 },
    ]);
    const brokerageId = plan.accountIdByDraftId['d-brokerage'];
    const loanId = plan.accountIdByDraftId['d-loan'];
    expect(
      plan.transactions.filter(t => t.account === brokerageId),
    ).toMatchObject([
      {
        amount: 490000,
        date: '2026-01-20',
        category: null,
        starting_balance_flag: true,
      },
      { amount: 10000, imported_id: 'f-brokerage-0', category: null },
    ]);
    expect(plan.transactions.filter(t => t.account === loanId)).toEqual([]);
    expect(plan.payees.filter(p => p.transfer_acct === loanId)).toHaveLength(1);
  });

  test('writes nothing to the database', async () => {
    await db.insertPayee({ id: 'coffee', name: 'Coffee Shop' });
    const tables = ['accounts', 'payees', 'payee_mapping', 'transactions'];
    const before = await Promise.all(tables.map(countRows));

    await planCreate(input([checking(), card()]));

    expect(await Promise.all(tables.map(countRows))).toEqual(before);
  });

  test('rejects accounts that are not ready to create', async () => {
    const unmapped = card();
    unmapped.files = [{ ...unmapped.files[0], rows: [], needsMapping: true }];

    await expect(
      planCreate(input([checking(), unmapped])),
    ).rejects.toBeInstanceOf(SetupValidationError);
    await expect(planCreate(input([]))).rejects.toBeInstanceOf(
      SetupValidationError,
    );
  });

  test('rejects a confirmed pair whose rows are gone or no longer match', async () => {
    // A removed file: the out row no longer exists
    await expect(
      planCreate(
        input(
          [checking(), card()],
          [{ outRowId: 'f-checking:9', inRowId: 'f-card:0' }],
        ),
      ),
    ).rejects.toBeInstanceOf(SetupValidationError);
    // A remapped file: -450 out does not match -2500
    await expect(
      planCreate(
        input(
          [checking(), card()],
          [{ outRowId: 'f-checking:0', inRowId: 'f-card:0' }],
        ),
      ),
    ).rejects.toBeInstanceOf(SetupValidationError);
  });

  test('rejects a row used by two confirmed pairs', async () => {
    const payment = row('f-checking', 2, '2026-01-12', -5000, 'CARD PAYMENT');
    const cardSide = row('f-card', 1, '2026-01-13', 5000, 'PAYMENT THANKS');
    const savings = account(
      'd-savings',
      'Savings',
      'f-savings',
      [row('f-savings', 0, '2026-01-14', 5000, 'TRANSFER IN')],
      { type: 'savings', entered: 5000 },
    );
    // Each pair is valid on its own; together they use the payment twice
    const pairs = [
      { outRowId: payment.id, inRowId: cardSide.id },
      { outRowId: payment.id, inRowId: 'f-savings:0' },
    ];

    await expect(
      planCreate(
        input([checking([payment]), card([cardSide]), savings], pairs),
      ),
    ).rejects.toThrow(/more than one confirmed transfer/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/core run test:node src/server/bank-file-setup/plan-create.test.ts`
Expected: FAIL. The test file cannot resolve `./plan-create`: "Failed to load url ./plan-create ... Does the file exist?"

- [ ] **Step 3: Extract the two helpers `planCreate` shares with existing code**

In `packages/loot-core/src/server/accounts/payees.ts`, replace `getStartingBalancePayee` (lines 18-35) with a read-only category lookup and a wrapper that behaves as before:

```ts
// The category a starting balance transaction gets: the income category
// named "Starting Balances", else any income category
export async function getStartingBalanceCategory(): Promise<
  db.DbCategory['id'] | null
> {
  let category = await db.first<db.DbCategory>(`
    SELECT * FROM categories
      WHERE is_income = 1 AND
      LOWER(name) = 'starting balances' AND
      tombstone = 0
  `);
  if (category === null) {
    category = await db.first<db.DbCategory>(
      'SELECT * FROM categories WHERE is_income = 1 AND tombstone = 0',
    );
  }
  return category ? category.id : null;
}

export async function getStartingBalancePayee() {
  const category = await getStartingBalanceCategory();
  const id = await createPayee('Starting Balance');
  return { id, category };
}
```

In `packages/loot-core/src/server/accounts/sync.ts`, add this directly after `normalizePayeeName` (after line 434):

```ts
// Trims an imported payee name and applies the normalization. A name that
// is only whitespace becomes null. Shared with bank file setup's planCreate.
export function normalizeImportedPayeeName(
  payeeName: string | null | undefined,
  normalization: PayeeNameNormalization,
): string | null | undefined {
  if (!payeeName) {
    return payeeName;
  }
  const trimmed = payeeName.trim();
  return trimmed === '' ? null : normalizePayeeName(trimmed, normalization);
}
```

and in `normalizeTransactions`, replace lines 475-483:

```ts
let payee_name = originalPayeeName;
if (payee_name) {
  const trimmed = payee_name.trim();
  if (trimmed === '') {
    payee_name = null;
  } else {
    payee_name = normalizePayeeName(trimmed, payeeNameNormalization);
  }
}
```

with:

```ts
const payee_name = normalizeImportedPayeeName(
  originalPayeeName,
  payeeNameNormalization,
);
```

- [ ] **Step 4: Run the existing import and account tests to verify the extraction changed nothing**

Run: `yarn workspace @actual-app/core run test:node src/server/accounts`
Expected: PASS, with the same test count as before the change.

- [ ] **Step 5: Implement `planCreate`**

Create `packages/loot-core/src/server/bank-file-setup/plan-create.ts`:

```ts
import { v4 as uuidv4 } from 'uuid';

import { getStartingBalanceCategory } from '#server/accounts/payees';
import { normalizeImportedPayeeName } from '#server/accounts/sync';
import * as db from '#server/db';
import { shoveSortOrders, TRANSACTION_SORT_INCREMENT } from '#server/db/sort';
import { buildReview, validateTransferPair } from '#shared/bank-file-setup';
import type {
  Review,
  ReviewAccount,
  SetupAccountDraft,
  SetupRow,
  TransferPair,
} from '#shared/bank-file-setup';
import type { TransactionEntity } from '#types/models';

export type SetupCreateInput = {
  accounts: SetupAccountDraft[];
  confirmedPairs: TransferPair[];
  today: string;
};

export type PlannedPayee = {
  id: string;
  name: string;
  transfer_acct?: string;
};

export type CreatePlan = {
  accounts: Array<Record<string, unknown>>;
  payees: PlannedPayee[];
  transactions: Array<Record<string, unknown>>;
  accountIdByDraftId: Record<string, string>;
  transactionCount: number;
};

export class SetupValidationError extends Error {}

type PlannedAccount = {
  id: string;
  name: string;
  offbudget: 0 | 1;
  closed: 0;
  sort_order: number;
  account_group_id: null;
};

type PlannedTransaction = Omit<
  TransactionEntity,
  'category' | 'notes' | 'imported_id' | 'imported_payee' | 'subtransactions'
> & {
  category: string | null;
  notes?: string | null;
  imported_id?: string | null;
  imported_payee?: string | null;
};

// Payees by lowercased name: the existing ones and every one this plan
// creates, so a name used by two rows or two accounts becomes one payee
type PayeeNames = {
  idByName: Map<string, string>;
  created: PlannedPayee[];
};

const STARTING_BALANCE_PAYEE = 'Starting Balance';

// Step 1 of Create (D6): validate, then build every row to insert while
// reading the database and never writing to it
export async function planCreate(input: SetupCreateInput): Promise<CreatePlan> {
  const review = validateInput(input);
  const accounts = await planAccounts(input.accounts);
  // createAccount gives every account a transfer payee
  const transferPayees = accounts.map(account => ({
    id: uuidv4(),
    name: '',
    transfer_acct: account.id,
  }));
  const payees = await loadPayeeNames();
  const startingCategory = await getStartingBalanceCategory();
  const now = Date.now();

  const transactions: PlannedTransaction[] = [];
  let transactionCount = 0;
  for (const [index, account] of accounts.entries()) {
    const reviewed = review.accounts[index];
    const starting = startingBalanceTransaction(
      account,
      reviewed,
      startingCategory,
      payees,
    );
    if (starting) {
      transactions.push(starting);
    }
    transactions.push(
      ...importedTransactions(account, reviewed.rows, payees, now),
    );
    transactionCount += reviewed.rows.length;
  }

  // As createNewPayees does in the import: only payees a row ended up using
  const usedPayeeIds = new Set(transactions.map(t => t.payee));
  return {
    accounts,
    payees: [
      ...transferPayees,
      ...payees.created.filter(payee => usedPayeeIds.has(payee.id)),
    ],
    transactions,
    accountIdByDraftId: Object.fromEntries(
      input.accounts.map((draft, index) => [draft.id, accounts[index].id]),
    ),
    transactionCount,
  };
}

function validateInput(input: SetupCreateInput): Review {
  if (input.accounts.length === 0) {
    throw new SetupValidationError('There are no accounts to create.');
  }
  if (input.accounts.some(draft => draft.name.trim() === '')) {
    throw new SetupValidationError('Every account needs a name.');
  }

  const review = buildReview(input.accounts, input.today);
  if (!review.ready) {
    throw new SetupValidationError(
      'Some accounts still need columns or a balance.',
    );
  }

  const rowsById = new Map<string, { draftId: string; row: SetupRow }>();
  for (const reviewed of review.accounts) {
    for (const row of reviewed.rows) {
      rowsById.set(row.id, { draftId: reviewed.draftId, row });
    }
  }

  // validateTransferPair checks one pair; a row may also be in only one
  const pairedRowIds = new Set<string>();
  for (const pair of input.confirmedPairs) {
    if (!validateTransferPair(pair, rowsById)) {
      throw new SetupValidationError(
        'A confirmed transfer no longer matches its transactions.',
      );
    }
    for (const rowId of [pair.outRowId, pair.inRowId]) {
      if (pairedRowIds.has(rowId)) {
        throw new SetupValidationError(
          'A transaction is in more than one confirmed transfer.',
        );
      }
      pairedRowIds.add(rowId);
    }
  }

  return review;
}

// Each new account goes after the existing accounts in its on-budget or
// off-budget set, and after the new accounts placed before it, as
// insertAccount (server/db/index.ts) places one account at a time
async function planAccounts(
  drafts: SetupAccountDraft[],
): Promise<PlannedAccount[]> {
  const sets: Record<0 | 1, Array<Pick<db.DbAccount, 'id' | 'sort_order'>>> = {
    0: await existingSortOrders(0),
    1: await existingSortOrders(1),
  };

  return drafts.map(draft => {
    const offbudget = draft.offbudget ? 1 : 0;
    const set = sets[offbudget];
    const { sort_order } = shoveSortOrders(set);
    const account: PlannedAccount = {
      id: uuidv4(),
      name: draft.name.trim(),
      offbudget,
      closed: 0,
      sort_order,
      account_group_id: null,
    };
    set.push({ id: account.id, sort_order });
    return account;
  });
}

// The query insertAccount uses, including closed and deleted accounts
function existingSortOrders(offbudget: 0 | 1) {
  return db.all<Pick<db.DbAccount, 'id' | 'sort_order'>>(
    'SELECT id, sort_order FROM accounts WHERE offbudget = ? ORDER BY sort_order, name',
    [offbudget],
  );
}

async function loadPayeeNames(): Promise<PayeeNames> {
  const rows = await db.all<Pick<db.DbPayee, 'id' | 'name'>>(
    'SELECT id, name FROM payees WHERE tombstone = 0',
  );
  const idByName = new Map<string, string>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (!idByName.has(key)) {
      idByName.set(key, row.id);
    }
  }
  return { idByName, created: [] };
}

// Matches by case-insensitive name, as the import's resolvePayee and
// createPayee do against the database, and plans a payee when none matches
function payeeIdForName(payees: PayeeNames, name: string): string {
  const key = name.toLowerCase();
  const existing = payees.idByName.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const payee = { id: uuidv4(), name };
  payees.idByName.set(key, payee.id);
  payees.created.push(payee);
  return payee.id;
}

// The fields createAccount sets, dated and valued by the review
function startingBalanceTransaction(
  account: PlannedAccount,
  reviewed: ReviewAccount,
  startingCategory: string | null,
  payees: PayeeNames,
): PlannedTransaction | null {
  // createAccount creates no transaction for a zero balance
  if (reviewed.starting === null || reviewed.starting.amount === 0) {
    return null;
  }
  return {
    id: uuidv4(),
    account: account.id,
    amount: reviewed.starting.amount,
    category: account.offbudget === 1 ? null : startingCategory,
    payee: payeeIdForName(payees, STARTING_BALANCE_PAYEE),
    date: reviewed.starting.date,
    cleared: true,
    starting_balance_flag: true,
  };
}

function importedTransactions(
  account: PlannedAccount,
  rows: SetupRow[],
  payees: PayeeNames,
  now: number,
): PlannedTransaction[] {
  const added = rows.map(row => importedTransaction(account, row, payees));
  // As reconcileTransactions does: the first row gets the highest sort order
  added.forEach((transaction, index) => {
    transaction.sort_order ??= now - index * TRANSACTION_SORT_INCREMENT;
  });
  return added;
}

// The fields normalizeTransactions and reconcileTransactions set on a new
// imported row
function importedTransaction(
  account: PlannedAccount,
  row: SetupRow,
  payees: PayeeNames,
): PlannedTransaction {
  const payeeName = normalizeImportedPayeeName(row.payeeName, 'title-case');
  const importedPayee = row.importedPayee || payeeName || null;
  return {
    id: uuidv4(),
    account: account.id,
    date: row.date,
    amount: row.amount,
    payee: payeeName ? payeeIdForName(payees, payeeName) : null,
    imported_payee: importedPayee ? importedPayee.trim() : null,
    notes: row.notes,
    imported_id: row.importedId,
    category: null,
    cleared: true,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @actual-app/core run test:node src/server/bank-file-setup/plan-create.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Typecheck, lint and commit**

Run: `yarn typecheck`
Expected: no errors. `plan-create.ts` and its test are strict; do not add `// @ts-strict-ignore`.

Run: `yarn lint:fix`
Expected: no remaining errors in the changed files.

```bash
git add packages/loot-core/src/server/bank-file-setup/plan-create.ts packages/loot-core/src/server/bank-file-setup/plan-create.test.ts packages/loot-core/src/server/accounts/payees.ts packages/loot-core/src/server/accounts/sync.ts
git commit -m "[AI] Plan bank file setup accounts, payees and transactions without writing"
```

---

### Task 6: planCreate, part 2: rules, splits and transfers

**Files:**

- Modify: `packages/loot-core/src/server/bank-file-setup/plan-create.ts` (from Task 5)
- Modify: `packages/loot-core/src/server/accounts/sync.ts:45` (export `makeSplitTransaction`)
- Test: `packages/loot-core/src/server/bank-file-setup/plan-create.test.ts`

**Interfaces:**

- Consumes (Task 4): `runRules(trans, accounts, { resolvePayeeNames: false })`. When a rule sets a payee name, the result has `payee: 'new'` and `payee_name`, and nothing is inserted. Existing: `makeSplitTransaction(trans, subtransactions)` from `server/accounts/sync.ts`, and `TransactionForRules` from `server/transactions/transaction-rules.ts`.
- Produces: the same `planCreate(input): Promise<CreatePlan>`. Its plan now includes the results of rules, split rows, linked confirmed pairs, and counterparts for rows that a rule gave a transfer payee.

The order follows the existing import. Rules run on every imported row, using an accounts map that includes the new accounts, as in `matchTransactions`. Then comes the category clearing from `batchUpdateTransactions`. Then confirmed pairs are linked the way "make transfer" links them, and each remaining row with a transfer payee gets a counterpart built the way `transfer.addTransfer` builds one. Raw inserts in step 2 run no transfer logic, so a confirmed pair never gets a third row.

- [ ] **Step 1: Write the failing tests**

In `plan-create.test.ts`, change the rules import to:

```ts
import { insertRule, loadRules } from '#server/transactions/transaction-rules';
```

add these helpers after `countRows`:

```ts
function transferPayeeOf(plan: CreatePlan, accountId: string) {
  const found = plan.payees.find(payee => payee.transfer_acct === accountId);
  if (!found) {
    throw new Error(`No transfer payee for ${accountId}`);
  }
  return found.id;
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  return items[0];
}
```

and append this `describe` block. The first two tests pin Review Focus 3.

```ts
describe('planCreate with rules and transfers', () => {
  test('a rule that renames a payee plans one payee and writes none', async () => {
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'SQ *BLUE BOTTLE' },
      ],
      actions: [{ op: 'set', field: 'payee_name', value: 'Blue Bottle' }],
    });
    const payeesBefore = await countRows('payees');

    const plan = await planCreate(
      input([
        checking([row('f-checking', 2, '2026-01-10', -600, 'SQ *BLUE BOTTLE')]),
        card([row('f-card', 1, '2026-01-07', -700, 'SQ *BLUE BOTTLE')]),
      ]),
    );

    // The title-cased original name is not used by any row, so it is dropped
    expect(createdPayeeNames(plan)).toEqual([
      'Acme Payroll',
      'Blue Bottle',
      'Coffee Shop',
      'Grocer',
      'Starting Balance',
    ]);
    const blueBottle = payeeIdByName(plan, 'Blue Bottle');
    expect(byImportedId(plan, 'f-checking-2').payee).toBe(blueBottle);
    expect(byImportedId(plan, 'f-card-1').payee).toBe(blueBottle);
    expect(await countRows('payees')).toBe(payeesBefore);
  });

  test('a rule that renames to an existing payee reuses it', async () => {
    await db.insertPayee({ id: 'blue-bottle', name: 'Blue Bottle' });
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'SQ *BLUE BOTTLE' },
      ],
      actions: [{ op: 'set', field: 'payee_name', value: 'blue bottle' }],
    });

    const plan = await planCreate(
      input([
        checking([row('f-checking', 2, '2026-01-10', -600, 'SQ *BLUE BOTTLE')]),
      ]),
    );

    expect(byImportedId(plan, 'f-checking-2').payee).toBe('blue-bottle');
    expect(createdPayeeNames(plan)).toEqual([
      'Acme Payroll',
      'Coffee Shop',
      'Starting Balance',
    ]);
  });

  test('a split rule makes a parent and its children', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'COSTCO' }],
      actions: [
        {
          op: 'set-split-amount',
          field: 'amount',
          value: -3000,
          options: { splitIndex: 1, method: 'fixed-amount' },
        },
        {
          op: 'set',
          field: 'category',
          value: 'groceries',
          options: { splitIndex: 1 },
        },
        {
          op: 'set-split-amount',
          field: 'amount',
          value: null,
          options: { splitIndex: 2, method: 'remainder' },
        },
        {
          op: 'set',
          field: 'category',
          value: 'household',
          options: { splitIndex: 2 },
        },
      ],
    });
    const costco = account(
      'd-checking',
      'Chase Checking',
      'f-checking',
      [row('f-checking', 0, '2026-01-08', -10000, 'COSTCO')],
      { entered: 90000 },
    );

    const plan = await planCreate(input([costco]));

    const parent = byImportedId(plan, 'f-checking-0');
    expect(parent).toMatchObject({
      is_parent: true,
      amount: -10000,
      category: null,
      sort_order: NOW,
    });
    // -10000 - (-3000) leaves -7000 for the remainder
    expect(
      plan.transactions.filter(t => t.parent_id === parent.id),
    ).toMatchObject([
      { is_child: true, amount: -3000, category: 'groceries' },
      { is_child: true, amount: -7000, category: 'household' },
    ]);
    expect(plan.transactionCount).toBe(1);
  });

  test('a confirmed pair between an on-budget and an off-budget account keeps the category', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'TRANSFER TO BROKERAGE' },
      ],
      actions: [{ op: 'set', field: 'category', value: 'investing' }],
    });
    const chk = account(
      'd-checking',
      'Chase Checking',
      'f-checking',
      [row('f-checking', 0, '2026-01-12', -50000, 'TRANSFER TO BROKERAGE')],
      { entered: 100000 },
    );
    // 80000 on 2026-01-13: starting balance 80000 - 50000 = 30000
    const brokerage = account(
      'd-brokerage',
      'Brokerage',
      'f-brokerage',
      [row('f-brokerage', 0, '2026-01-13', 50000, 'TRANSFER FROM CHECKING')],
      { type: 'other', offbudget: true, entered: 80000 },
    );

    const plan = await planCreate(
      input(
        [chk, brokerage],
        [{ outRowId: 'f-checking:0', inRowId: 'f-brokerage:0' }],
      ),
    );

    const checkingId = plan.accountIdByDraftId['d-checking'];
    const brokerageId = plan.accountIdByDraftId['d-brokerage'];
    const out = byImportedId(plan, 'f-checking-0');
    const into = byImportedId(plan, 'f-brokerage-0');
    expect(out).toMatchObject({
      transfer_id: into.id,
      payee: transferPayeeOf(plan, brokerageId),
      category: 'investing',
    });
    expect(into).toMatchObject({
      transfer_id: out.id,
      payee: transferPayeeOf(plan, checkingId),
      category: null,
    });
    // Two starting balances and the two linked rows; no third transfer row
    expect(plan.transactions).toHaveLength(4);
  });

  test('a confirmed pair between two on-budget accounts clears the category', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'imported_payee', value: 'CARD PAYMENT' },
      ],
      actions: [{ op: 'set', field: 'category', value: 'household' }],
    });
    const payment = row('f-checking', 2, '2026-01-12', -5000, 'CARD PAYMENT');
    const cardSide = row('f-card', 1, '2026-01-13', 5000, 'PAYMENT THANKS');

    const plan = await planCreate(
      input(
        [checking([payment]), card([cardSide])],
        [{ outRowId: payment.id, inRowId: cardSide.id }],
      ),
    );

    expect(byImportedId(plan, 'f-checking-2')).toMatchObject({
      transfer_id: byImportedId(plan, 'f-card-1').id,
      category: null,
    });
    expect(byImportedId(plan, 'f-card-1').category).toBeNull();
  });

  test('a rule that sets a transfer payee plans the counterpart, with rules run on it', async () => {
    await db.insertAccount({ id: 'savings', name: 'Savings' });
    await db.insertPayee({
      id: 'transfer-savings',
      name: '',
      transfer_acct: 'savings',
    });
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'TO SAVINGS' }],
      actions: [
        { op: 'set', field: 'payee', value: 'transfer-savings' },
        { op: 'set', field: 'category', value: 'groceries' },
      ],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'account', value: 'savings' }],
      actions: [{ op: 'set', field: 'notes', value: 'Moved from checking' }],
    });
    const chk = account(
      'd-checking',
      'Chase Checking',
      'f-checking',
      [row('f-checking', 0, '2026-01-15', -20000, 'TO SAVINGS')],
      { entered: 100000 },
    );

    const plan = await planCreate(input([chk]));

    const checkingId = plan.accountIdByDraftId['d-checking'];
    const source = byImportedId(plan, 'f-checking-0');
    const counterpart = only(
      plan.transactions.filter(t => t.account === 'savings'),
    );
    expect(counterpart).toMatchObject({
      amount: 20000,
      date: '2026-01-15',
      payee: transferPayeeOf(plan, checkingId),
      transfer_id: source.id,
      cleared: false,
      notes: 'Moved from checking',
    });
    // Both accounts are on budget, so the rule's category is cleared
    expect(source).toMatchObject({
      payee: 'transfer-savings',
      transfer_id: counterpart.id,
      category: null,
    });
    expect(plan.transactionCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/core run test:node src/server/bank-file-setup/plan-create.test.ts`
Expected: FAIL. The 7 Task 5 tests pass and the 6 new tests fail. No rules run yet: the rename test finds no 'Blue Bottle' payee, the split test gets `is_parent` undefined, the pair tests get `transfer_id` undefined, and the counterpart test finds no row in `savings`.

- [ ] **Step 3: Export `makeSplitTransaction`**

In `packages/loot-core/src/server/accounts/sync.ts`, line 45, change `function makeSplitTransaction(trans, subtransactions) {` to:

```ts
export function makeSplitTransaction(trans, subtransactions) {
```

- [ ] **Step 4: Run rules, splits and transfers in the plan**

In `packages/loot-core/src/server/bank-file-setup/plan-create.ts`:

Replace the import of `normalizeImportedPayeeName` with:

```ts
import {
  makeSplitTransaction,
  normalizeImportedPayeeName,
} from '#server/accounts/sync';
```

and add after the `#server/db/sort` import:

```ts
import { runRules } from '#server/transactions/transaction-rules';
import type { TransactionForRules } from '#server/transactions/transaction-rules';
```

Add this type after `PayeeNames`:

```ts
type PlanContext = {
  // Existing accounts and the new ones, for rules and budget checks
  accountsById: Map<string, db.DbAccount>;
  payees: PayeeNames;
  // The transfer payee of each new account
  transferPayeeIdByAccountId: Map<string, string>;
  // Every transfer payee, existing and new, to the account it pays into
  transferAccountIdByPayeeId: Map<string, string>;
};
```

Replace the whole `planCreate` function with:

```ts
export async function planCreate(input: SetupCreateInput): Promise<CreatePlan> {
  const review = validateInput(input);
  const accounts = await planAccounts(input.accounts);
  // createAccount gives every account a transfer payee
  const transferPayees = accounts.map(account => ({
    id: uuidv4(),
    name: '',
    transfer_acct: account.id,
  }));
  const context: PlanContext = {
    accountsById: await accountsForRules(accounts),
    payees: await loadPayeeNames(),
    transferPayeeIdByAccountId: new Map(
      transferPayees.map(payee => [payee.transfer_acct, payee.id]),
    ),
    transferAccountIdByPayeeId: await existingTransferPayees(),
  };
  for (const payee of transferPayees) {
    context.transferAccountIdByPayeeId.set(payee.id, payee.transfer_acct);
  }
  const startingCategory = await getStartingBalanceCategory();
  const pairedRowIds = new Set(
    input.confirmedPairs.flatMap(pair => [pair.outRowId, pair.inRowId]),
  );
  const now = Date.now();

  const transactions: PlannedTransaction[] = [];
  const transactionByRowId = new Map<string, PlannedTransaction>();
  for (const [index, account] of accounts.entries()) {
    const reviewed = review.accounts[index];
    const starting = startingBalanceTransaction(
      account,
      reviewed,
      startingCategory,
      context.payees,
    );
    if (starting) {
      transactions.push(starting);
    }
    const imported = await importedTransactions(
      account,
      reviewed.rows,
      pairedRowIds,
      context,
      now,
    );
    transactions.push(...imported.transactions);
    for (const [rowId, transaction] of imported.byRowId) {
      transactionByRowId.set(rowId, transaction);
    }
  }

  linkConfirmedPairs(input.confirmedPairs, transactionByRowId, context);
  transactions.push(...(await transferCounterparts(transactions, context)));

  // As createNewPayees does in the import: only payees a row ended up using
  const usedPayeeIds = new Set(transactions.map(t => t.payee));
  return {
    accounts,
    payees: [
      ...transferPayees,
      ...context.payees.created.filter(payee => usedPayeeIds.has(payee.id)),
    ],
    transactions,
    accountIdByDraftId: Object.fromEntries(
      input.accounts.map((draft, index) => [draft.id, accounts[index].id]),
    ),
    transactionCount: transactionByRowId.size,
  };
}
```

Replace `importedTransactions` and `importedTransaction` with:

```ts
async function importedTransactions(
  account: PlannedAccount,
  rows: SetupRow[],
  pairedRowIds: Set<string>,
  context: PlanContext,
  now: number,
): Promise<{
  transactions: PlannedTransaction[];
  byRowId: Map<string, PlannedTransaction>;
}> {
  const added: PlannedTransaction[] = [];
  const byRowId = new Map<string, PlannedTransaction>();
  for (const row of rows) {
    const planned = await importedTransaction(
      account,
      row,
      pairedRowIds.has(row.id),
      context,
    );
    if (planned.length > 0) {
      byRowId.set(row.id, planned[0]);
      added.push(...planned);
    }
  }
  // As reconcileTransactions does: the first row gets the highest sort
  // order; split children keep the 0, -1, ... that makeSplitTransaction set
  added.forEach((transaction, index) => {
    transaction.sort_order ??= now - index * TRANSACTION_SORT_INCREMENT;
  });
  return { transactions: added, byRowId };
}

// One imported row as normalizeTransactions, matchTransactions and
// reconcileTransactions build it: payee resolved by name, rules run, split
// if a rule split it. Returns [] when a rule deleted the row.
async function importedTransaction(
  account: PlannedAccount,
  row: SetupRow,
  isPaired: boolean,
  context: PlanContext,
): Promise<PlannedTransaction[]> {
  const payeeName = normalizeImportedPayeeName(row.payeeName, 'title-case');
  const importedPayee = row.importedPayee || payeeName || null;
  const ruled: TransactionForRules = await runRules(
    {
      account: account.id,
      date: row.date,
      amount: row.amount,
      payee: payeeName ? payeeIdForName(context.payees, payeeName) : null,
      imported_payee: importedPayee ? importedPayee.trim() : null,
      notes: row.notes,
      imported_id: row.importedId,
      category: null,
      cleared: true,
    },
    context.accountsById,
    { resolvePayeeNames: false },
  );
  // The delete-transaction action; reconcileTransactions skips such rows
  if (ruled.tombstone) {
    return [];
  }

  const {
    subtransactions,
    payee_name: _payeeName,
    tombstone: _tombstone,
    ...rest
  } = ruled;
  const transaction: PlannedTransaction = {
    ...rest,
    id: uuidv4(),
    payee: rulePayee(ruled, context.payees),
    category: ruled.category || null,
    cleared: ruled.cleared ?? true,
  };

  // A confirmed pair keeps the row whole so it can be linked as a transfer
  const planned: PlannedTransaction[] =
    !isPaired && subtransactions && subtransactions.length > 0
      ? makeSplitTransaction(
          transaction,
          subtransactions.map((child: TransactionForRules) => {
            const { payee_name: _childPayeeName, ...childRest } = child;
            return child.payee === 'new'
              ? { ...childRest, payee: rulePayee(child, context.payees) }
              : childRest;
          }),
        )
      : [transaction];

  // As batchUpdateTransactions does on insert: no category on split
  // parents or in off-budget accounts
  for (const plannedTransaction of planned) {
    if (plannedTransaction.is_parent || account.offbudget === 1) {
      plannedTransaction.category = null;
    }
  }
  return planned;
}

// runRules with resolvePayeeNames off leaves a rule-set name as payee 'new'
// and payee_name. Resolve it against the in-memory payees, as
// resolvePayeeNameForRules would against the database: case-insensitive,
// and a new payee keeps the name exactly as the rule set it.
function rulePayee(
  transaction: TransactionForRules,
  payees: PayeeNames,
): string | null {
  if (transaction.payee !== 'new') {
    return transaction.payee ?? null;
  }
  return transaction.payee_name
    ? payeeIdForName(payees, transaction.payee_name)
    : null;
}

// As "make transfer" links two rows: transfer_id both ways, each payee set
// to the other account's transfer payee. transfer.ts clears the category
// only when both accounts are on budget or both are off budget.
function linkConfirmedPairs(
  pairs: TransferPair[],
  transactionByRowId: Map<string, PlannedTransaction>,
  context: PlanContext,
) {
  for (const pair of pairs) {
    const out = transactionByRowId.get(pair.outRowId);
    const into = transactionByRowId.get(pair.inRowId);
    // A rule deleted one side; the other imports as an ordinary row
    if (out === undefined || into === undefined) {
      continue;
    }
    out.transfer_id = into.id;
    into.transfer_id = out.id;
    out.payee = context.transferPayeeIdByAccountId.get(into.account) ?? null;
    into.payee = context.transferPayeeIdByAccountId.get(out.account) ?? null;
    if (
      isOffBudget(context, out.account) === isOffBudget(context, into.account)
    ) {
      out.category = null;
      into.category = null;
    }
  }
}

// As transfer.onInsert and addTransfer handle a row inserted with a
// transfer payee: a counterpart in the other account with cleared false,
// taking only notes, cleared and schedule from its own rules
async function transferCounterparts(
  transactions: PlannedTransaction[],
  context: PlanContext,
): Promise<PlannedTransaction[]> {
  const counterparts: PlannedTransaction[] = [];
  for (const transaction of transactions) {
    const transferredAccount = transaction.payee
      ? context.transferAccountIdByPayeeId.get(transaction.payee)
      : undefined;
    // addTransfer skips split parents; linked pairs already have their row
    if (
      transferredAccount === undefined ||
      transaction.transfer_id ||
      transaction.is_parent
    ) {
      continue;
    }

    const base = {
      account: transferredAccount,
      amount: -transaction.amount,
      payee:
        context.transferPayeeIdByAccountId.get(transaction.account) ?? null,
      date: transaction.date,
      transfer_id: transaction.id,
      notes: transaction.notes || null,
      cleared: false,
      ...(transaction.schedule ? { schedule: transaction.schedule } : {}),
    };
    const { notes, cleared, schedule } = await runRules(
      base,
      context.accountsById,
      { resolvePayeeNames: false },
    );
    const matchedSchedule = schedule ?? transaction.schedule;
    const counterpart: PlannedTransaction = {
      ...base,
      id: uuidv4(),
      notes,
      cleared,
      category: null,
      ...(matchedSchedule ? { schedule: matchedSchedule } : {}),
    };

    transaction.transfer_id = counterpart.id;
    if (matchedSchedule) {
      transaction.schedule = matchedSchedule;
    }
    if (
      isOffBudget(context, transaction.account) ===
      isOffBudget(context, transferredAccount)
    ) {
      transaction.category = null;
    }
    counterparts.push(counterpart);
  }
  return counterparts;
}

async function accountsForRules(
  planned: PlannedAccount[],
): Promise<Map<string, db.DbAccount>> {
  const accountsById = new Map<string, db.DbAccount>(
    (await db.getAccounts()).map(account => [account.id, account]),
  );
  for (const account of planned) {
    accountsById.set(account.id, { ...account, tombstone: 0 });
  }
  return accountsById;
}

// The payees transfer.ts treats as transfers: v_payees leaves out those
// whose account was deleted
async function existingTransferPayees(): Promise<Map<string, string>> {
  const rows = await db.all<{ id: string; transfer_acct: string }>(
    'SELECT id, transfer_acct FROM v_payees WHERE transfer_acct IS NOT NULL',
  );
  return new Map(rows.map(row => [row.id, row.transfer_acct]));
}

function isOffBudget(context: PlanContext, accountId: string): boolean {
  return context.accountsById.get(accountId)?.offbudget === 1;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @actual-app/core run test:node src/server/bank-file-setup/plan-create.test.ts`
Expected: PASS, 13 tests.

Run: `yarn workspace @actual-app/core run test:node src/server/accounts`
Expected: PASS. The only change in `accounts/` is the `export` keyword.

- [ ] **Step 6: Typecheck, lint and commit**

Run: `yarn typecheck`
Expected: no errors.

Run: `yarn lint:fix`
Expected: no remaining errors in the changed files.

```bash
git add packages/loot-core/src/server/bank-file-setup/plan-create.ts packages/loot-core/src/server/bank-file-setup/plan-create.test.ts packages/loot-core/src/server/accounts/sync.ts
git commit -m "[AI] Run rules, splits and transfers in the bank file setup plan"
```

---

### Task 7: The setup handlers and step 2 of Create

**Files:**

- Create: `packages/loot-core/src/server/bank-file-setup/app.ts`
- Modify: `packages/loot-core/src/server/main.ts:16-17` (import) and `:132-155` (`app.combine`)
- Modify: `packages/loot-core/src/types/handlers.ts:1-50` (import and intersection)
- Test: `packages/loot-core/src/server/bank-file-setup/app.test.ts`

**Interfaces:**

- Consumes (Task 2): `parseFileContents(name, bytes, options)`, types `ParseFileOptions` and `ParseFileResult` from `server/transactions/import/parse-file.ts`. From Tasks 5 and 6: `planCreate`, `SetupValidationError`, `SetupCreateInput`, `CreatePlan`.
- Produces: `BankFileSetupHandlers` and `SetupCreateResult`, and the handlers `'setup-parse-file'` and `'setup-create'`, which clients reach with `send('setup-parse-file', ...)` and `send('setup-create', ...)` (Tasks 10 and 12).

`setup-parse-file` is a plain method, so parsing does not queue behind writes (D2). `setup-create` is `mutator(undoable(...))`, so it records one undo marker. Step 2 is one `batchMessages`, and inside it only `db.insertWithUUID`, `db.insertPayee` and `db.insertTransaction` are called. None of these reads the database. `db.insertPayee` validates the name, then writes the payee and its `payee_mapping` row through a nested `batchMessages`, which only runs its function while a batch is open.

Each insert is awaited before the next one starts. The awaits yield only microtasks, and nothing else is awaited inside the batch. This order is needed, not just tidy. If the inserts were started together and awaited with `Promise.all`, a throw part-way through would discard the batch while an `insertPayee` was still between its payee insert and its mapping insert. That mapping message would then arrive after `IS_BATCHING` was reset, and `sendMessages` would apply it on its own. The forced-throw test below counts `messages_crdt` and would catch that.

`batchMessages` rejects for a failure before the commit and also for one after it: `_applyMessages` runs undo recording, budget triggers and sync listeners after its SQLite transaction. The handler tells the two apart by reading whether the first planned account exists. If it does, the write committed, and the handler logs the error and returns success with a warning (D6, Review Focus 4).

- [ ] **Step 1: Write the failing tests**

Create `packages/loot-core/src/server/bank-file-setup/app.test.ts`:

```ts
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { handlers } from '#server/main';
import { isMutating } from '#server/mutators';
import { addSyncListener, setSyncingMode } from '#server/sync';
import { insertRule, loadRules } from '#server/transactions/transaction-rules';
import { clearUndo, undo, withUndo } from '#server/undo';
import type { SetupAccountDraft, SetupRow } from '#shared/bank-file-setup';

import { app } from './app';
import type { SetupCreateInput } from './plan-create';

const TODAY = '2026-02-01';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  clearUndo();
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'starting',
    name: 'Starting Balances',
    cat_group: 'income',
    is_income: 1,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  setSyncingMode('disabled');
});

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
    importedId: `${fileId}-${index}`,
  };
}

function account(
  id: string,
  name: string,
  fileId: string,
  rows: SetupRow[],
  patch: Partial<SetupAccountDraft>,
): SetupAccountDraft {
  return {
    id,
    name,
    bank: 'Chase',
    type: 'checking',
    offbudget: false,
    entered: null,
    files: [
      {
        id: fileId,
        name: `${fileId}.qfx`,
        format: 'qfx',
        rows,
        statement: null,
        csvBalance: null,
        needsMapping: false,
      },
    ],
    ...patch,
  };
}

// Starting balance 250000 - (-450 + 200000) = 50450 on 2026-01-05
function checking() {
  return account(
    'd-checking',
    'Chase Checking',
    'f-checking',
    [
      row('f-checking', 0, '2026-01-05', -450, 'COFFEE SHOP'),
      row('f-checking', 1, '2026-01-10', 200000, 'ACME PAYROLL'),
    ],
    { entered: 250000 },
  );
}

// 10000 owed: starting balance -10000 - (-2500) = -7500 on 2026-01-07
function card() {
  return account(
    'd-card',
    'Chase Card',
    'f-card',
    [row('f-card', 0, '2026-01-07', -2500, 'GROCER')],
    { type: 'credit', entered: 10000 },
  );
}

function input(
  confirmedPairs: SetupCreateInput['confirmedPairs'] = [],
): SetupCreateInput {
  return { accounts: [checking(), card()], confirmedPairs, today: TODAY };
}

async function countRows(table: string, where = '1 = 1') {
  const result = await db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`,
  );
  return result?.count ?? 0;
}

async function aliveCounts() {
  return {
    accounts: await countRows('accounts', 'tombstone = 0'),
    payees: await countRows('payees', 'tombstone = 0'),
    transactions: await countRows('transactions', 'tombstone = 0'),
  };
}

describe('setup-parse-file', () => {
  test('parses bytes and does not queue behind writes', async () => {
    expect(isMutating(app.handlers['setup-parse-file'])).toBe(false);
    expect(isMutating(app.handlers['setup-create'])).toBe(true);

    const csv = 'Date,Payee,Amount\n2026-01-05,Coffee Shop,-4.50\n';
    const result = await app.handlers['setup-parse-file']({
      name: 'checking.csv',
      bytes: new TextEncoder().encode(csv),
      options: { hasHeaderRow: true },
    });

    expect(result).toEqual({
      errors: [],
      transactions: [
        { Date: '2026-01-05', Payee: 'Coffee Shop', Amount: '-4.50' },
      ],
    });
  });

  test('both handlers are registered on the server', () => {
    expect(handlers['setup-parse-file']).toBe(app.handlers['setup-parse-file']);
    expect(handlers['setup-create']).toBe(app.handlers['setup-create']);
  });
});

describe('setup-create', () => {
  test('writes everything as one undo step', async () => {
    // An earlier undoable change, to show where the setup's step ends
    await withUndo(async () => {
      await db.insertPayee({ name: 'Before Setup' });
    });
    const before = await aliveCounts();

    const result = await app.handlers['setup-create'](input());

    expect(result).toEqual({
      ok: true,
      accountIds: [expect.any(String), expect.any(String)],
      transactionCount: 3,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const [checkingId, cardId] = result.accountIds;
    expect(
      await db.all(
        'SELECT id, name, offbudget, closed, account_group_id FROM accounts WHERE tombstone = 0 ORDER BY sort_order',
      ),
    ).toEqual([
      {
        id: checkingId,
        name: 'Chase Checking',
        offbudget: 0,
        closed: 0,
        account_group_id: null,
      },
      {
        id: cardId,
        name: 'Chase Card',
        offbudget: 0,
        closed: 0,
        account_group_id: null,
      },
    ]);
    expect(
      await db.all(
        'SELECT account, amount FROM v_transactions_internal_alive WHERE starting_balance_flag = 1 ORDER BY amount',
      ),
    ).toEqual([
      { account: cardId, amount: -7500 },
      { account: checkingId, amount: 50450 },
    ]);
    // Payee names resolve through payee_mapping, so the mapping rows exist
    expect(
      await db.all(
        `SELECT p.name FROM v_transactions_internal_alive t
           JOIN payees p ON p.id = t.payee
           WHERE t.imported_id IS NOT NULL ORDER BY t.imported_id`,
      ),
    ).toEqual([
      { name: 'Grocer' },
      { name: 'Coffee Shop' },
      { name: 'Acme Payroll' },
    ]);
    const transferAccounts = await db.all<{ transfer_acct: string }>(
      'SELECT transfer_acct FROM payees WHERE transfer_acct IS NOT NULL AND tombstone = 0',
    );
    expect(transferAccounts.map(p => p.transfer_acct).sort()).toEqual(
      [checkingId, cardId].sort(),
    );

    // One undo reverts all of it and nothing before it
    await undo();
    expect(await aliveCounts()).toEqual(before);
    expect(
      await countRows('payees', "name = 'Before Setup' AND tombstone = 0"),
    ).toBe(1);

    await undo();
    expect(
      await countRows('payees', "name = 'Before Setup' AND tombstone = 0"),
    ).toBe(0);
  });

  test('a failure while writing leaves the budget and the sync log unchanged', async () => {
    // Offline mode writes every local change to messages_crdt, the log
    // that sync uploads, without contacting a server
    setSyncingMode('offline');
    await insertRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'COFFEE SHOP' }],
      actions: [{ op: 'set', field: 'payee_name', value: 'Blue Bottle' }],
    });
    const tables = [
      'accounts',
      'payees',
      'payee_mapping',
      'transactions',
      'messages_crdt',
    ];
    const before = await Promise.all(tables.map(table => countRows(table)));

    const insertTransaction = db.insertTransaction;
    let calls = 0;
    vi.spyOn(db, 'insertTransaction').mockImplementation(transaction => {
      calls++;
      if (calls === 3) {
        throw new Error('disk full');
      }
      return insertTransaction(transaction);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await app.handlers['setup-create'](input());

    expect(result).toEqual({ ok: false, error: 'disk full' });
    expect(await Promise.all(tables.map(table => countRows(table)))).toEqual(
      before,
    );
    // The rule's payee was only ever planned
    expect(await countRows('payees', "name = 'Blue Bottle'")).toBe(0);

    // Nothing from the discarded batch is still buffered: the next write
    // sends only its own messages
    vi.mocked(db.insertTransaction).mockRestore();
    await db.insertAccount({ id: 'after-failure', name: 'After' });
    expect(await countRows('messages_crdt', "row != 'after-failure'")).toBe(
      before[tables.indexOf('messages_crdt')],
    );
    expect(await countRows('accounts')).toBe(before[0] + 1);
  });

  test('rejects a confirmed transfer whose rows no longer match', async () => {
    const result = await app.handlers['setup-create'](
      // -450 out and -2500 in: stale since the card file was remapped
      input([{ outRowId: 'f-checking:0', inRowId: 'f-card:0' }]),
    );

    expect(result).toEqual({
      ok: false,
      error: 'A confirmed transfer no longer matches its transactions.',
    });
    expect(await countRows('accounts')).toBe(0);
  });

  test('reports success with a warning when work after the commit fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    // Sync listeners run after the batch's SQLite transaction has committed
    const unlisten = addSyncListener(() => {
      throw new Error('listener failed');
    });

    try {
      const result = await app.handlers['setup-create'](input());

      expect(result).toEqual({
        ok: true,
        accountIds: [expect.any(String), expect.any(String)],
        transactionCount: 3,
        warning: 'listener failed',
      });
    } finally {
      unlisten();
    }
    expect(await countRows('accounts', 'tombstone = 0')).toBe(2);
    expect(consoleError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/core run test:node src/server/bank-file-setup/app.test.ts`
Expected: FAIL. The test file cannot resolve `./app`: "Failed to load url ./app ... Does the file exist?"

- [ ] **Step 3: Implement the handlers**

Create `packages/loot-core/src/server/bank-file-setup/app.ts`:

```ts
import { logger } from '#platform/server/log';
import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { batchMessages } from '#server/sync';
import { parseFileContents } from '#server/transactions/import/parse-file';
import type {
  ParseFileOptions,
  ParseFileResult,
} from '#server/transactions/import/parse-file';
import { undoable } from '#server/undo';

import { planCreate, SetupValidationError } from './plan-create';
import type { CreatePlan, SetupCreateInput } from './plan-create';

export type SetupCreateResult =
  | {
      ok: true;
      accountIds: string[];
      transactionCount: number;
      warning?: string;
    }
  | { ok: false; error: string };

export type BankFileSetupHandlers = {
  'setup-parse-file': (args: {
    name: string;
    bytes: Uint8Array;
    options?: ParseFileOptions;
  }) => Promise<ParseFileResult>;
  'setup-create': (input: SetupCreateInput) => Promise<SetupCreateResult>;
};

export const app = createApp<BankFileSetupHandlers>();
// Not a mutator, so parsing does not wait behind writes (D2)
app.method('setup-parse-file', parseSetupFile);
app.method('setup-create', mutator(undoable(createFromSetup)));

async function parseSetupFile({
  name,
  bytes,
  options,
}: {
  name: string;
  bytes: Uint8Array;
  options?: ParseFileOptions;
}): Promise<ParseFileResult> {
  return parseFileContents(name, bytes, options);
}

async function createFromSetup(
  input: SetupCreateInput,
): Promise<SetupCreateResult> {
  let plan: CreatePlan;
  try {
    plan = await planCreate(input);
  } catch (error) {
    if (!(error instanceof SetupValidationError)) {
      logger.error('Bank file setup: could not plan the accounts', error);
    }
    return { ok: false, error: errorMessage(error) };
  }

  const accountIds = input.accounts.map(
    draft => plan.accountIdByDraftId[draft.id],
  );
  try {
    await writePlan(plan);
  } catch (error) {
    // Undo recording, budget triggers and sync listeners run after the
    // batch's SQLite transaction commits, and can still throw. Once the
    // rows exist, reporting a failure would invite a second Create.
    if (await isWritten(accountIds[0])) {
      logger.error(
        'Bank file setup: accounts were created, but a step after the write failed',
        error,
      );
      return {
        ok: true,
        accountIds,
        transactionCount: plan.transactionCount,
        warning: errorMessage(error),
      };
    }
    logger.error('Bank file setup: nothing was created', error);
    return { ok: false, error: errorMessage(error) };
  }

  return { ok: true, accountIds, transactionCount: plan.transactionCount };
}

// Step 2 of Create (D6): one batch of raw inserts, none of which reads the
// database. Each insert finishes before the next starts, so a throw leaves
// no insert half done to send a message after the batch is discarded.
async function writePlan(plan: CreatePlan): Promise<void> {
  await batchMessages(async () => {
    for (const account of plan.accounts) {
      await db.insertWithUUID('accounts', account);
    }
    for (const payee of plan.payees) {
      // Writes the payee and its payee_mapping row; its batch joins this one
      await db.insertPayee(payee);
    }
    for (const transaction of plan.transactions) {
      await db.insertTransaction(transaction);
    }
  });
}

async function isWritten(accountId: string): Promise<boolean> {
  const row = await db.first<Pick<db.DbAccount, 'id'>>(
    'SELECT id FROM accounts WHERE id = ?',
    [accountId],
  );
  return row !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Register the app**

In `packages/loot-core/src/server/main.ts`, add after line 16 (`import { app as authApp } from './auth/app';`):

```ts
import { app as bankFileSetupApp } from './bank-file-setup/app';
```

and add `bankFileSetupApp,` to the `app.combine(...)` call (lines 132-155), after `authApp,`:

```ts
app.combine(
  authApp,
  bankFileSetupApp,
  schedulesApp,
```

In `packages/loot-core/src/types/handlers.ts`, add after line 4 (`import type { AuthHandlers } from '#server/auth/app';`):

```ts
import type { BankFileSetupHandlers } from '#server/bank-file-setup/app';
```

and extend the intersection's last line from `AuthHandlers;` to:

```ts
AuthHandlers & BankFileSetupHandlers;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @actual-app/core run test:node src/server/bank-file-setup`
Expected: PASS, 19 tests: 13 in `plan-create.test.ts` and 6 in `app.test.ts`.

Run: `yarn workspace @actual-app/core run test:node src/server/main.test.ts`
Expected: PASS. Registration adds two names, and `app.method` throws on a conflicting name.

- [ ] **Step 6: Typecheck, lint and commit**

Run: `yarn typecheck`
Expected: no errors. `undoable(createFromSetup)` only type-checks once `BankFileSetupHandlers` is part of `Handlers`, which is why `types/handlers.ts` is in this commit.

Run: `yarn lint:fix`
Expected: no remaining errors in the changed files.

```bash
git add packages/loot-core/src/server/bank-file-setup/app.ts packages/loot-core/src/server/bank-file-setup/app.test.ts packages/loot-core/src/server/main.ts packages/loot-core/src/types/handlers.ts
git commit -m "[AI] Add the bank file setup parse and create handlers"
```

---

### Task 8: LiveRegion

**Files:**

- Create: `packages/desktop-client/src/components/LiveRegion.tsx`
- Test: `packages/desktop-client/src/components/LiveRegion.test.tsx`

**Interfaces:**

- Consumes: nothing from earlier tasks. Uses `styles.visuallyHidden` from `@actual-app/components/styles` and `View` from `@actual-app/components/view`.
- Produces: `LiveRegion(): JSX.Element` (import from `#components/LiveRegion`), mounted once per page; `useAnnounce(): (message: string) => void`, callable from any component whether it sits above, beside or below the region.

- [ ] **Step 1: Write the failing test**

`packages/desktop-client/src/components/LiveRegion.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LiveRegion, useAnnounce } from './LiveRegion';

function Announcer({ messages }: { messages: string[] }) {
  const announce = useAnnounce();
  return (
    <button
      type="button"
      onClick={() => messages.forEach(message => announce(message))}
    >
      Announce
    </button>
  );
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

describe('LiveRegion', () => {
  it('renders one polite, atomic status region that starts empty', () => {
    render(<LiveRegion />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toBeEmptyDOMElement();
  });

  it('announces from a component rendered before the region', async () => {
    render(
      <>
        <Announcer messages={['Parsed Chase checking.qfx: 212 transactions']} />
        <LiveRegion />
      </>,
    );
    const region = screen.getByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Announce' }));
    // Cleared synchronously, set on the next frame
    expect(region).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(region).toHaveTextContent(
        'Parsed Chase checking.qfx: 212 transactions',
      ),
    );
  });

  it('re-announces an identical message by clearing it first', async () => {
    render(
      <>
        <LiveRegion />
        <Announcer messages={['Starting balance updated']} />
      </>,
    );
    const region = screen.getByRole('status');
    const button = screen.getByRole('button', { name: 'Announce' });

    fireEvent.click(button);
    await waitFor(() =>
      expect(region).toHaveTextContent('Starting balance updated'),
    );

    fireEvent.click(button);
    expect(region).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(region).toHaveTextContent('Starting balance updated'),
    );
  });

  it('drops a message replaced before its frame', async () => {
    render(
      <>
        <LiveRegion />
        <Announcer messages={['Parsing statement.csv', 'Needs columns']} />
      </>,
    );
    const region = screen.getByRole('status');
    const seen: string[] = [];
    const observer = new MutationObserver(() =>
      seen.push(region.textContent ?? ''),
    );
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Announce' }));
    await waitFor(() => expect(region).toHaveTextContent('Needs columns'));
    await nextFrame();
    observer.disconnect();

    expect(seen).not.toContain('Parsing statement.csv');
    expect(region).toHaveTextContent('Needs columns');
  });

  it('does not carry a message to the next page’s region', async () => {
    const first = render(
      <>
        <LiveRegion />
        <Announcer messages={['Created 3 accounts']} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Announce' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Created 3 accounts',
      ),
    );
    first.unmount();

    render(<LiveRegion />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @actual-app/web run test src/components/LiveRegion.test.tsx`
Expected: FAIL, `Failed to resolve import "./LiveRegion"`.

- [ ] **Step 3: Implement**

`packages/desktop-client/src/components/LiveRegion.tsx`:

```tsx
import { useEffect, useSyncExternalStore } from 'react';

import { styles } from '@actual-app/components/styles';
import { View } from '@actual-app/components/view';

// One message for the page's single region. A module store rather than a
// context, so the component that mounts the region can announce too.
let currentMessage = '';
let pendingFrame: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentMessage;
}

function setMessage(message: string) {
  currentMessage = message;
  listeners.forEach(listener => listener());
}

function cancelPendingFrame() {
  if (pendingFrame !== null) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }
}

function announce(message: string) {
  // Clear, then set on the next frame: screen readers only announce a
  // change, so an identical message would otherwise be skipped.
  cancelPendingFrame();
  setMessage('');
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    setMessage(message);
  });
}

export function LiveRegion() {
  const message = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(
    () => () => {
      cancelPendingFrame();
      currentMessage = '';
    },
    [],
  );

  return (
    <View
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={styles.visuallyHidden}
    >
      {message}
    </View>
  );
}

export function useAnnounce(): (message: string) => void {
  return announce;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn workspace @actual-app/web run test src/components/LiveRegion.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
yarn typecheck
yarn lint:fix
git add packages/desktop-client/src/components/LiveRegion.tsx packages/desktop-client/src/components/LiveRegion.test.tsx
git commit -m "[AI] Add a polite live region and useAnnounce"
```

---

### Task 9: CSV mapping without an account

**Files:**

- Create: `packages/desktop-client/src/components/modals/ImportTransactionsModal/importSettings.ts`
- Create: `packages/desktop-client/src/components/bank-file-setup/csvRows.ts`
- Create: `packages/desktop-client/src/components/bank-file-setup/CsvMappingModal.tsx`
- Modify: `packages/desktop-client/src/components/modals/ImportTransactionsModal/ImportTransactionsModal.tsx:43-58` (imports), `:90-168` (delete the two guessing helpers), `:428-441` (csv branch of `parse`), `:724-774` (save), `:1436-1442` (delete `isOfxFile`/`isCamtFile`)
- Modify: `packages/desktop-client/src/components/modals/ImportTransactionsModal/utils.ts:158-172` (`FieldMapping`, `applyFieldMappings`), `:302-315` (`stripCsvImportTransaction`), append the two guessing helpers
- Modify: `packages/desktop-client/src/components/modals/ImportTransactionsModal/FieldMappings.tsx:1-144` (whole file: wider rows, `showBalance`/`showCategory`, named pickers)
- Modify: `packages/desktop-client/src/components/modals/ImportTransactionsModal/DateFormatSelect.tsx:12-17` (props)
- Modify: `packages/desktop-client/src/components/modals/ImportTransactionsModal/SelectField.tsx:1-44` (whole file: `aria-label`)
- Modify: `packages/component-library/src/Select.tsx:1` (import), `:31-43` (props), `:60-72` (destructure), `:81-105` (button and value span)
- Modify: `packages/desktop-client/package.json:36-58` (subpath imports)
- Modify: `packages/desktop-client/src/modals/modalsSlice.ts:24-29` (import), `:44-52` (modal entry)
- Modify: `packages/desktop-client/src/components/Modals.tsx:13` (import), `:132-133` (case)
- Test: `packages/desktop-client/src/components/modals/ImportTransactionsModal/importSettings.test.ts`
- Test: `packages/desktop-client/src/components/modals/ImportTransactionsModal/utils.test.ts`
- Test: `packages/desktop-client/src/components/modals/ImportTransactionsModal/FieldMappings.test.tsx`
- Test: `packages/desktop-client/src/components/bank-file-setup/csvRows.test.ts`
- Create: `packages/desktop-client/src/components/bank-file-setup/csvFixtures.ts` (test fixtures)
- Test: `packages/desktop-client/src/components/bank-file-setup/CsvMappingModal.test.tsx`

**Interfaces:**

- Consumes: `SetupRow` from `@actual-app/core/shared/bank-file-setup` [Task 3]; `amountToInteger`, `looselyParseAmount`, `integerToCurrency` from `@actual-app/core/shared/util`.
- Produces:
  - `importSettings.ts` (`#components/modals/ImportTransactionsModal/importSettings`): `type ImportSettings`, `importSettingsPrefs(accountId: string, fileType: string, settings: ImportSettings): Record<string, string>`, `defaultImportSettings(fileName: string): Omit<ImportSettings, 'fieldMappings' | 'parseDateFormat'>`, `isOfxFile(fileType)`, `isCamtFile(fileType)`.
  - `utils.ts` (`#components/modals/ImportTransactionsModal/utils`): `FieldMapping` with optional `balance?: string | null`; `getInitialMappings(transactions: ReadonlyArray<unknown>): Partial<FieldMapping>`; `getInitialDateFormat(transactions: ReadonlyArray<unknown>, mappings: { date?: string | null }): DateFormat`.
  - `csvRows.ts` (`#components/bank-file-setup/csvRows`): `type CsvMapping`, `type CsvRawRow`, `csvToSetupRows(fileId, rawRows, mapping)`, `csvRowRecord(row)`, `buildCsvMapping(base, fields)`, `initialCsvMapping(fileName, rawRows)`.
  - Modal `'bank-file-setup-csv-mapping'` with options `{ fileName: string; rawRows: CsvRawRow[]; initial: CsvMapping | null; onDone: (mapping: CsvMapping) => void }`, opened with `dispatch(pushModal({ modal: { name: 'bank-file-setup-csv-mapping', options } }))`. Its confirm button is named "Done"; its column pickers are buttons named Date, Payee, Notes, Amount, Outflow, Inflow, In/Out and Balance (Category is hidden in this modal), each described by its chosen column.

#### Part (a): the saved-settings helper

- [ ] **Step 1: Write the failing test**

The expected tables are the dialog's save code (`ImportTransactionsModal.tsx:724-774`) read branch by branch for each file type `getFileType` can return. Every setting has a non-default value so a swapped key or value fails. The `qbo` row pins today's fall-through: the dialog does not treat `.qbo` as OFX, so it writes a date format for it.

`packages/desktop-client/src/components/modals/ImportTransactionsModal/importSettings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @actual-app/web run test src/components/modals/ImportTransactionsModal/importSettings.test.ts`
Expected: FAIL, `Failed to resolve import "./importSettings"`.

- [ ] **Step 3: Implement**

`packages/desktop-client/src/components/modals/ImportTransactionsModal/importSettings.ts`:

```ts
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
    prefs[`csv-mappings-${accountId}`] = JSON.stringify(settings.fieldMappings);
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
```

Switch the dialog to it. In `ImportTransactionsModal.tsx`, replace lines 724-774 (from `if (!isOfxFile(filetype) && !isCamtFile(filetype)) {` through the `import-reimport-deleted` `savePrefs` call) with:

```ts
savePrefs(
  importSettingsPrefs(accountId, filetype, {
    fieldMappings,
    parseDateFormat,
    delimiter,
    encoding: csvEncoding,
    hasHeaderRow,
    skipStartLines,
    skipEndLines,
    inOutMode,
    outValue,
    flipAmount,
    importNotes,
    fallbackMissingPayeeToMemo,
    ofxSwapPayeeAndMemo,
    qifSwapPayeeAndMemo,
    camtSwapPayeeAndMemo,
    reimportDeleted,
  }),
);
```

One `savePrefs` call now carries the keys the separate calls did; `saveSyncedPrefs` sends one `preferences/save` per key either way. Delete the local `isOfxFile` and `isCamtFile` at lines 1436-1442, and add `import { importSettingsPrefs, isCamtFile, isOfxFile } from './importSettings';` after `import { FieldMappings } from './FieldMappings';` (line 50). Step 7 rewrites this import block again when the guessing helpers move.

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn workspace @actual-app/web run test src/components/modals/ImportTransactionsModal/importSettings.test.ts`
Expected: PASS, 8 tests.

#### Part (b): guessing helpers in utils.ts, a Balance column, and named column pickers

- [ ] **Step 5: Write the failing test**

Append to `packages/desktop-client/src/components/modals/ImportTransactionsModal/utils.test.ts`. Change its first import line to `import { filterByStartDate, getInitialDateFormat, getInitialMappings, parseCategoryFields, parseDate } from './utils';`, then add at the end of the file:

```ts
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

  test('getInitialMappings ignores the dialog’s preview fields', () => {
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
```

Every column picker gets its visible label as its accessible name, and the chosen column as its description. The column names in the fixture differ from the labels so the test cannot pass by matching the button's text.

`packages/desktop-client/src/components/modals/ImportTransactionsModal/FieldMappings.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';

import { FieldMappings } from './FieldMappings';
import type { FieldMapping } from './utils';

const row = {
  'Transaction Date': '09/14/2026',
  Description: 'STARBUCKS STORE 03512',
  Memo: 'coffee',
  Type: 'Sale',
  'Debit/Credit': '-4.50',
  Direction: 'out',
  'Running Bal': '2380.55',
};

const mappings: FieldMapping = {
  date: 'Transaction Date',
  payee: 'Description',
  notes: 'Memo',
  category: 'Type',
  amount: 'Debit/Credit',
  inOut: 'Direction',
  outflow: null,
  inflow: null,
  balance: 'Running Bal',
};

function renderMappings(
  props: Partial<Parameters<typeof FieldMappings>[0]> = {},
) {
  return render(
    <FieldMappings
      transactions={[row]}
      mappings={mappings}
      onChange={vi.fn()}
      splitMode={false}
      inOutMode={false}
      hasHeaderRow
      {...props}
    />,
  );
}

describe('FieldMappings', () => {
  it('names each column picker by its label and describes it by the chosen column', () => {
    renderMappings({ showBalance: true });
    const expected: Array<[string, string]> = [
      ['Date', 'Transaction Date'],
      ['Payee', 'Description'],
      ['Notes', 'Memo'],
      ['Category', 'Type'],
      ['Amount', 'Debit/Credit'],
      ['Balance', 'Running Bal'],
    ];
    for (const [label, column] of expected) {
      expect(
        screen.getByRole('button', { name: label }),
      ).toHaveAccessibleDescription(column);
    }
  });

  it('names the outflow, inflow and in/out pickers', () => {
    const { unmount } = renderMappings({
      splitMode: true,
      mappings: { ...mappings, amount: null, outflow: 'Debit/Credit' },
    });
    expect(
      screen.getByRole('button', { name: 'Outflow' }),
    ).toHaveAccessibleDescription('Debit/Credit');
    expect(screen.getByRole('button', { name: 'Inflow' })).toBeInTheDocument();
    unmount();

    renderMappings({ inOutMode: true });
    expect(
      screen.getByRole('button', { name: 'In/Out' }),
    ).toHaveAccessibleDescription('Direction');
  });

  it('keeps the import dialog’s layout: category shown, no balance', () => {
    renderMappings();
    expect(
      screen.getByRole('button', { name: 'Category' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Balance' }),
    ).not.toBeInTheDocument();
  });

  it('hides category when asked', () => {
    renderMappings({ showCategory: false });
    expect(
      screen.queryByRole('button', { name: 'Category' }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `yarn workspace @actual-app/web run test src/components/modals/ImportTransactionsModal/utils.test.ts src/components/modals/ImportTransactionsModal/FieldMappings.test.tsx`
Expected: FAIL. In `utils.test.ts`, `column guessing` fails with `TypeError: getInitialMappings is not a function` because the helpers are still local to the dialog. In `FieldMappings.test.tsx`, `Unable to find an accessible element with the role "button" and name "Date"` because the pickers are named by their current value.

- [ ] **Step 7: Implement**

In `utils.ts`, replace `FieldMapping` and the signature of `applyFieldMappings` (lines 158-172). The parameter widens to `Partial<ImportTransaction>` so a raw CSV row (`Record<string, string>`) can be mapped; the body is unchanged.

```ts
export type FieldMapping = {
  date: string | null;
  amount: string | null;
  payee: string | null;
  notes: string | null;
  inOut: string | null;
  category: string | null;
  outflow: string | null;
  inflow: string | null;
  /** Running balance column; only the bank file setup flow maps it */
  balance?: string | null;
};

export function applyFieldMappings(
  transaction: Partial<ImportTransaction>,
  mappings: FieldMapping,
) {
```

Widen `stripCsvImportTransaction` the same way (line 302): `export function stripCsvImportTransaction(transaction: Partial<ImportTransaction>) {`.

Append to `utils.ts` (moved from `ImportTransactionsModal.tsx:90-168`, typed, same logic; the preview-field filter is the set `stripCsvImportTransaction` removes):

```ts
const PREVIEW_FIELDS = new Set([
  'existing',
  'ignored',
  'selected',
  'selected_merge',
  'trx_id',
  'tombstone',
]);

export function getInitialMappings(
  transactions: ReadonlyArray<unknown>,
): Partial<FieldMapping> {
  const first = transactions[0];
  if (typeof first !== 'object' || first === null) {
    return {};
  }

  const fields = Object.entries(first).filter(
    ([name]) => !PREVIEW_FIELDS.has(name),
  );

  function key(entry: [string, unknown] | undefined) {
    return entry ? entry[0] : null;
  }

  const dateField = key(
    fields.find(([name]) => name.toLowerCase().includes('date')) ||
      fields.find(([, value]) => String(value).match(/^\d+[-/]\d+[-/]\d+$/)),
  );

  const amountField = key(
    fields.find(([name]) => name.toLowerCase().includes('amount')) ||
      fields.find(([, value]) => String(value).match(/^-?[.,\d]+$/)),
  );

  const categoryField = key(
    fields.find(([name]) => name.toLowerCase().includes('category')),
  );

  const payeeField = key(
    fields.find(([name]) => name.toLowerCase().includes('payee')) ||
      fields.find(
        ([name]) =>
          name !== dateField && name !== amountField && name !== categoryField,
      ),
  );

  const notesField = key(
    fields.find(([name]) => name.toLowerCase().includes('notes')) ||
      fields.find(
        ([name]) =>
          name !== dateField &&
          name !== amountField &&
          name !== categoryField &&
          name !== payeeField,
      ),
  );

  const inOutField = key(
    fields.find(
      ([name]) =>
        name !== dateField &&
        name !== amountField &&
        name !== payeeField &&
        name !== notesField,
    ),
  );

  return {
    date: dateField,
    amount: amountField,
    payee: payeeField,
    notes: notesField,
    inOut: inOutField,
    category: categoryField,
  };
}

export function getInitialDateFormat(
  transactions: ReadonlyArray<unknown>,
  mappings: { date?: string | null },
): DateFormat {
  const first = transactions[0];
  if (first === undefined || mappings.date == null) {
    return 'yyyy mm dd';
  }

  const date: unknown =
    typeof first === 'object' && first !== null
      ? Reflect.get(first, mappings.date)
      : null;

  // parseDate rejects anything but a string, so a non-string finds nothing
  const found =
    typeof date === 'string'
      ? dateFormats.find(f => parseDate(date, f.format) != null)
      : null;
  return found ? found.format : 'mm dd yyyy';
}
```

In `ImportTransactionsModal.tsx`:

1. Replace the local imports at lines 49-58 with:

```ts
import { DateFormatSelect } from './DateFormatSelect';
import { FieldMappings } from './FieldMappings';
import { importSettingsPrefs, isCamtFile, isOfxFile } from './importSettings';
import { InOutOption } from './InOutOption';
import { MultiplierOption } from './MultiplierOption';
import { Transaction } from './Transaction';
import type { DateFormat, FieldMapping, ImportTransaction } from './utils';
import {
  applyFieldMappings,
  filterByStartDate,
  getInitialDateFormat,
  getInitialMappings,
  isDateFormat,
  parseAmountFields,
  parseCategoryFields,
  parseDate,
} from './utils';
```

2. Delete `getInitialDateFormat` and `getInitialMappings` (lines 90-168).

3. In `parse`, the csv branch (lines 430-441) held the saved mappings in a variable typed from the pref (`string`). The typed `getInitialDateFormat` would reject that string (TS2559), so type the variable as what it holds. Replace:

```ts
let mappings = prefs[`csv-mappings-${accountId}`];
mappings = mappings ? JSON.parse(mappings) : getInitialMappings(transactions);

// @ts-expect-error - mappings might not have outflow/inflow properties
setFieldMappings(mappings);

// Set initial split mode based on any saved mapping
// @ts-expect-error - mappings might not have outflow/inflow properties
const splitMode = !!(mappings.outflow || mappings.inflow);
```

with:

```ts
const savedMappings = prefs[`csv-mappings-${accountId}`];
const mappings: Partial<FieldMapping> = savedMappings
  ? JSON.parse(savedMappings)
  : getInitialMappings(transactions);

// @ts-expect-error - mappings might not have outflow/inflow properties
setFieldMappings(mappings);

// Set initial split mode based on any saved mapping
const splitMode = !!(mappings.outflow || mappings.inflow);
```

The runtime values are identical. The first `@ts-expect-error` still has an error to suppress (`Partial<FieldMapping>` into `FieldMapping`), and the second is removed because `mappings.outflow` is now valid.

Give the column pickers accessible names. In `packages/component-library/src/Select.tsx`, change the React import (line 1) to `import { useId, useRef, useState } from 'react';`, add to `SelectProps<Value>` (after `className?: string;`):

```ts
  /**
   * Names the trigger. The chosen option's text then becomes its
   * description, so it is still announced.
   */
  'aria-label'?: string;
```

add `'aria-label': ariaLabel,` to the destructured props, add `const valueId = useId();` after `const [isOpen, setIsOpen] = useState(false);`, and give the trigger and its value span these attributes:

```tsx
      <Button
        ref={triggerRef}
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaLabel ? valueId : undefined}
        variant={bare ? 'bare' : 'normal'}
        isDisabled={disabled}
        onPress={() => {
          setIsOpen(true);
        }}
        style={style}
        className={className}
      >
```

```tsx
          <span
            id={valueId}
            style={{
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              width: 'calc(100% - 7px)',
            }}
          >
```

Every existing `Select` passes no `aria-label`, so its button keeps its current name and gains no description.

Replace `packages/desktop-client/src/components/modals/ImportTransactionsModal/SelectField.tsx` with:

```tsx
import React from 'react';
import type { CSSProperties } from 'react';

import { Select } from '@actual-app/components/select';

type SelectFieldProps = {
  style?: CSSProperties;
  options: string[];
  value: null | string;
  onChange: (newValue: string) => void;
  hasHeaderRow: boolean;
  firstTransaction: Record<string, unknown>;
  /** The picker's visible label, e.g. "Payee" */
  'aria-label': string;
};

export function SelectField({
  style,
  options,
  value,
  onChange,
  hasHeaderRow,
  firstTransaction,
  'aria-label': ariaLabel,
}: SelectFieldProps) {
  const columns = options.map(
    option =>
      [
        option,
        hasHeaderRow
          ? option
          : `Column ${parseInt(option) + 1} (${String(firstTransaction[option])})`,
      ] as const,
  );

  // If selected column does not exist in transaction sheet, ignore
  if (!columns.find(col => col[0] === value)) value = null;

  return (
    <Select
      aria-label={ariaLabel}
      options={[['choose-field', 'Choose field...'], ...columns]}
      value={value === null ? 'choose-field' : value}
      onChange={onChange}
      style={style}
    />
  );
}
```

Replace `packages/desktop-client/src/components/modals/ImportTransactionsModal/FieldMappings.tsx` with the version below. It widens the rows to `Partial<ImportTransaction>` so raw CSV rows fit, adds `showBalance` (default off) and `showCategory` (default on), and passes each picker's label as its `aria-label`. Each picker is built by a small `Picker` helper at the bottom of the file, since the eight pickers differ only in field and label; the markup each renders is the one the file has today.

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';

import { SpaceBetween } from '@actual-app/components/space-between';
import { View } from '@actual-app/components/view';

import { SectionLabel } from '#components/forms';

import { SelectField } from './SelectField';
import { SubLabel } from './SubLabel';
import { stripCsvImportTransaction } from './utils';
import type { FieldMapping, ImportTransaction } from './utils';

type FieldMappingsProps = {
  transactions: Array<Partial<ImportTransaction>>;
  mappings?: FieldMapping;
  onChange: (field: keyof FieldMapping, newValue: string) => void;
  splitMode: boolean;
  inOutMode: boolean;
  hasHeaderRow: boolean;
  /** Offer a Balance column (bank file setup only) */
  showBalance?: boolean;
  /** The setup flow does not import categories */
  showCategory?: boolean;
};

export function FieldMappings({
  transactions,
  mappings = {
    date: null,
    amount: null,
    payee: null,
    notes: null,
    inOut: null,
    category: null,
    outflow: null,
    inflow: null,
    balance: null,
  },
  onChange,
  splitMode,
  inOutMode,
  hasHeaderRow,
  showBalance = false,
  showCategory = true,
}: FieldMappingsProps) {
  const { t } = useTranslation();
  if (transactions.length === 0) {
    return null;
  }

  const trans = stripCsvImportTransaction(transactions[0]);
  const options = Object.keys(trans);
  const shared = {
    options,
    mappings,
    onChange,
    hasHeaderRow,
    firstTransaction: transactions[0],
  };

  return (
    <View>
      <SectionLabel title={t('CSV FIELDS')} />
      <SpaceBetween gap={10} style={{ marginTop: 5, alignItems: 'flex-start' }}>
        <Picker {...shared} field="date" label={t('Date')} />
        <Picker {...shared} field="payee" label={t('Payee')} />
        <Picker {...shared} field="notes" label={t('Notes')} />
        {showCategory && (
          <Picker {...shared} field="category" label={t('Category')} />
        )}
        {splitMode && !inOutMode ? (
          <>
            <Picker
              {...shared}
              field="outflow"
              label={t('Outflow')}
              flex={0.5}
            />
            <Picker {...shared} field="inflow" label={t('Inflow')} flex={0.5} />
          </>
        ) : (
          <>
            {inOutMode && (
              <Picker {...shared} field="inOut" label={t('In/Out')} />
            )}
            <Picker {...shared} field="amount" label={t('Amount')} />
          </>
        )}
        {showBalance && (
          <Picker {...shared} field="balance" label={t('Balance')} />
        )}
      </SpaceBetween>
    </View>
  );
}

type PickerProps = {
  field: keyof FieldMapping;
  label: string;
  flex?: number;
  options: string[];
  mappings: FieldMapping;
  onChange: (field: keyof FieldMapping, newValue: string) => void;
  hasHeaderRow: boolean;
  firstTransaction: Partial<ImportTransaction>;
};

function Picker({
  field,
  label,
  flex = 1,
  options,
  mappings,
  onChange,
  hasHeaderRow,
  firstTransaction,
}: PickerProps) {
  return (
    <View style={{ flex }}>
      <SubLabel title={label} />
      <SelectField
        aria-label={label}
        options={options}
        value={mappings[field] ?? null}
        onChange={name => onChange(field, name)}
        hasHeaderRow={hasHeaderRow}
        firstTransaction={firstTransaction}
      />
    </View>
  );
}
```

The import dialog passes neither new prop, so it renders the same pickers in the same order; the only difference is that each picker's button is now named by its label.

In `DateFormatSelect.tsx` (line 13), widen `transactions: ImportTransaction[];` to `transactions: Array<Partial<ImportTransaction>>;`.

- [ ] **Step 8: Run it to verify it passes**

Run: `yarn workspace @actual-app/web run test src/components/modals/ImportTransactionsModal/`
Expected: PASS. `utils.test.ts` includes the 4 new tests, `FieldMappings.test.tsx` passes 4, and `importSettings.test.ts` still passes.

#### Part (c): CSV rows to setup rows

- [ ] **Step 9: Add the subpath imports**

In `packages/desktop-client/package.json` `imports`, add before `"#components/banksync"` (line 37):

```json
    "#components/bank-file-setup/csvRows": "./src/components/bank-file-setup/csvRows.ts",
```

and after the `"#components/modals/BudgetAutomationsModal/migrateTemplatesToAutomations"` entry (line 57):

```json
    "#components/modals/ImportTransactionsModal/importSettings": "./src/components/modals/ImportTransactionsModal/importSettings.ts",
    "#components/modals/ImportTransactionsModal/utils": "./src/components/modals/ImportTransactionsModal/utils.ts",
```

- [ ] **Step 10: Write the failing test**

The fixtures are rows as `setup-parse-file` returns them for a CSV parsed with a header row. The card file is newest first, with two identical coffees on one day. The checking file has a Balance column whose values chain correctly (505.05, then -4.50, -500.00, +2500.00, -120.00), with two rows on the latest day.

`packages/desktop-client/src/components/bank-file-setup/csvFixtures.ts` (shared by this test and the modal test; a test file importing another test file would register its tests twice):

```ts
export const chaseCard = [
  {
    'Transaction Date': '09/14/2026',
    'Post Date': '09/15/2026',
    Description: 'STARBUCKS STORE 03512',
    Category: 'Food & Drink',
    Type: 'Sale',
    Amount: '-4.50',
    Memo: '',
  },
  {
    'Transaction Date': '09/14/2026',
    'Post Date': '09/15/2026',
    Description: 'STARBUCKS STORE 03512',
    Category: 'Food & Drink',
    Type: 'Sale',
    Amount: '-4.50',
    Memo: '',
  },
  {
    'Transaction Date': '09/12/2026',
    'Post Date': '09/13/2026',
    Description: 'SHELL OIL 57444',
    Category: 'Gas',
    Type: 'Sale',
    Amount: '-38.21',
    Memo: '',
  },
  {
    'Transaction Date': '09/10/2026',
    'Post Date': '09/10/2026',
    Description: 'Payment Thank You-Mobile',
    Category: '',
    Type: 'Payment',
    Amount: '500.00',
    Memo: '',
  },
  {
    'Transaction Date': '09/06/2026',
    'Post Date': '09/08/2026',
    Description: 'TRADER JOE S #552',
    Category: 'Groceries',
    Type: 'Sale',
    Amount: '-61.07',
    Memo: '',
  },
  {
    'Transaction Date': '09/03/2026',
    'Post Date': '09/05/2026',
    Description: 'AMAZON MKTPL*2K4AB1',
    Category: 'Shopping',
    Type: 'Sale',
    Amount: '-23.99',
    Memo: 'Birthday gift',
  },
  {
    'Transaction Date': '09/02/2026',
    'Post Date': '09/03/2026',
    Description: 'AMAZON MKTPL*RETURN',
    Category: 'Shopping',
    Type: 'Return',
    Amount: '12.00',
    Memo: '',
  },
];

export const chaseChecking = [
  {
    Details: 'DEBIT',
    'Posting Date': '09/15/2026',
    Description: 'Zelle payment to Jane Doe 18236',
    Amount: '-120.00',
    Type: 'QUICKPAY_DEBIT',
    Balance: '2380.55',
    'Check or Slip #': '',
  },
  {
    Details: 'CREDIT',
    'Posting Date': '09/15/2026',
    Description: 'ACME CORP PAYROLL PPD ID: 9111111101',
    Amount: '2500.00',
    Type: 'ACH_CREDIT',
    Balance: '2500.55',
    'Check or Slip #': '',
  },
  {
    Details: 'DEBIT',
    'Posting Date': '09/12/2026',
    Description: 'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224',
    Amount: '-500.00',
    Type: 'ACH_DEBIT',
    Balance: '0.55',
    'Check or Slip #': '',
  },
  {
    Details: 'DEBIT',
    'Posting Date': '09/10/2026',
    Description: 'STARBUCKS STORE 03512',
    Amount: '-4.50',
    Type: 'DEBIT_CARD',
    Balance: '500.55',
    'Check or Slip #': '',
  },
  {
    Details: 'CREDIT',
    'Posting Date': '09/01/2026',
    Description: 'INTEREST PAYMENT',
    Amount: '0.05',
    Type: 'MISC_CREDIT',
    Balance: '505.05',
    'Check or Slip #': '',
  },
];
```

`packages/desktop-client/src/components/bank-file-setup/csvRows.test.ts`:

```ts
import { buildCsvMapping, csvToSetupRows, initialCsvMapping } from './csvRows';
import { defaultImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';

import { chaseCard, chaseChecking } from './csvFixtures';

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

  test('an unreadable date skips that row and keeps the others’ ids', () => {
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

  test('a missing amount column is an error and yields no rows', () => {
    const mapping = initialCsvMapping(CARD_FILE, chaseCard);
    const result = csvToSetupRows('card', chaseCard, {
      ...mapping,
      fieldMappings: { ...mapping.fieldMappings, amount: null },
    });
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
```

Error strings go through `t()` from `i18next`, which returns `undefined` in tests because nothing initializes it, so the tests assert on counts, not text.

- [ ] **Step 11: Run it to verify it fails**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/csvRows.test.ts`
Expected: FAIL, `Failed to resolve import "./csvRows"`.

- [ ] **Step 12: Implement**

`packages/desktop-client/src/components/bank-file-setup/csvRows.ts`:

```ts
import { t } from 'i18next';

import type { SetupRow } from '@actual-app/core/shared/bank-file-setup';
import {
  amountToInteger,
  looselyParseAmount,
} from '@actual-app/core/shared/util';

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

export function csvRowRecord(row: CsvRawRow): Record<string, string> {
  return Array.isArray(row)
    ? Object.fromEntries(row.map((value, index) => [String(index), value]))
    : row;
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
): { rows: SetupRow[]; balance: CsvBalance | null; errors: string[] } {
  const { fieldMappings, dateFormat } = mapping;
  if (!isDateFormat(dateFormat)) {
    return { rows: [], balance: null, errors: [t('Choose a date format.')] };
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
    return { rows: [], balance: null, errors: missing };
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

    // As the import dialog does: an unreadable amount becomes 0
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

  return { rows, balance: latestBalance(rows, balances), errors };
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
```

- [ ] **Step 13: Run it to verify it passes**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/csvRows.test.ts`
Expected: PASS, 10 tests.

#### Part (d): the mapping modal

- [ ] **Step 14: Write the failing test**

`packages/desktop-client/src/components/bank-file-setup/CsvMappingModal.test.tsx`:

```tsx
import { initServer } from '@actual-app/core/platform/client/connection';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { defaultImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';
import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';

import { CsvMappingModal } from './CsvMappingModal';
import { chaseCard } from './csvFixtures';
import { initialCsvMapping } from './csvRows';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

const FILE = 'Chase1234_Activity20260915.CSV';

function setup(initial: ReturnType<typeof initialCsvMapping> | null = null) {
  const savePref = vi.fn();
  initServer({ 'preferences/save': savePref });
  const store = configureTestAppStore({ queryClient: createTestQueryClient() });
  const prefsBefore = store.getState().prefs.synced;
  const onDone = vi.fn();
  render(
    <TestProviders store={store}>
      <CsvMappingModal
        fileName={FILE}
        rawRows={chaseCard}
        initial={initial}
        onDone={onDone}
      />
    </TestProviders>,
  );
  return { savePref, store, prefsBefore, onDone };
}

describe('CsvMappingModal', () => {
  it('previews five rows', () => {
    setup();
    expect(screen.getAllByTestId('csv-preview-row')).toHaveLength(5);
  });

  it('returns the edited mapping, closes, and touches no synced prefs', async () => {
    const user = userEvent.setup();
    const { savePref, store, prefsBefore, onDone } = setup();

    // Notes: Memo -> Type, found by the picker's label
    const notes = screen.getByRole('button', { name: 'Notes' });
    expect(notes).toHaveAccessibleDescription('Memo');
    await user.click(notes);
    await user.click(
      within(await screen.findByRole('menu')).getByRole('button', {
        name: 'Type',
      }),
    );
    await user.click(screen.getByLabelText('Flip amount'));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const fieldMappings = {
      date: 'Transaction Date',
      amount: 'Amount',
      payee: 'Description',
      notes: 'Type',
      inOut: null,
      category: null,
      outflow: null,
      inflow: null,
      balance: null,
    };
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({
      fieldMappings,
      dateFormat: 'mm dd yyyy',
      flipAmount: true,
      multiplier: '',
      inOutMode: false,
      outValue: '',
      settings: {
        ...defaultImportSettings(FILE),
        hasHeaderRow: true,
        fieldMappings,
        parseDateFormat: 'mm dd yyyy',
        flipAmount: true,
        inOutMode: false,
        outValue: '',
      },
    });

    expect(savePref).not.toHaveBeenCalled();
    expect(store.getState().prefs.synced).toBe(prefsBefore);
    await waitFor(() =>
      expect(
        screen.queryByTestId('bank-file-setup-csv-mapping-modal'),
      ).not.toBeInTheDocument(),
    );
  });

  it('starts from the mapping it is given', () => {
    const initial = {
      ...initialCsvMapping(FILE, chaseCard),
      flipAmount: true,
    };
    setup(initial);
    expect(screen.getByLabelText('Flip amount')).toBeChecked();
  });
});
```

- [ ] **Step 15: Run it to verify it fails**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/CsvMappingModal.test.tsx`
Expected: FAIL, `Failed to resolve import "./CsvMappingModal"`.

- [ ] **Step 16: Implement**

Register the modal. In `packages/desktop-client/src/modals/modalsSlice.ts`, add after line 26 (`import type { SelectLinkedAccountsModalProps } ...`):

```ts
import type {
  CsvMapping,
  CsvRawRow,
} from '#components/bank-file-setup/csvRows';
```

and after the `'import-transactions'` member (ends line 52):

```ts
  | {
      name: 'bank-file-setup-csv-mapping';
      options: {
        fileName: string;
        rawRows: CsvRawRow[];
        initial: CsvMapping | null;
        onDone: (mapping: CsvMapping) => void;
      };
    }
```

In `packages/desktop-client/src/components/Modals.tsx`, add before line 13 (`import { EditSyncAccount } ...`):

```ts
import { CsvMappingModal } from './bank-file-setup/CsvMappingModal';
```

and after the `'import-transactions'` case (lines 132-133):

```tsx
        case 'bank-file-setup-csv-mapping':
          return <CsvMappingModal key={key} {...modal.options} />;
```

`packages/desktop-client/src/components/bank-file-setup/CsvMappingModal.tsx`:

```tsx
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SpaceBetween } from '@actual-app/components/space-between';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { integerToCurrency } from '@actual-app/core/shared/util';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { SectionLabel } from '#components/forms';
import { LabeledCheckbox } from '#components/forms/LabeledCheckbox';
import { DateFormatSelect } from '#components/modals/ImportTransactionsModal/DateFormatSelect';
import { FieldMappings } from '#components/modals/ImportTransactionsModal/FieldMappings';
import { InOutOption } from '#components/modals/ImportTransactionsModal/InOutOption';
import { MultiplierOption } from '#components/modals/ImportTransactionsModal/MultiplierOption';
import { isDateFormat } from '#components/modals/ImportTransactionsModal/utils';
import type {
  DateFormat,
  FieldMapping,
} from '#components/modals/ImportTransactionsModal/utils';
import type { Modal as ModalType } from '#modals/modalsSlice';

import {
  buildCsvMapping,
  csvRowRecord,
  csvToSetupRows,
  initialCsvMapping,
} from './csvRows';

type CsvMappingModalProps = Extract<
  ModalType,
  { name: 'bank-file-setup-csv-mapping' }
>['options'];

const PREVIEW_ROW_COUNT = 5;

/**
 * Column mapping for one CSV in the bank file setup flow. It returns a
 * mapping and nothing else: no import, and no saved settings read or
 * written (the flow writes them after Create, under the new account).
 */
export function CsvMappingModal({
  fileName,
  rawRows,
  initial,
  onDone,
}: CsvMappingModalProps) {
  const { t } = useTranslation();
  const [start] = useState(
    () => initial ?? initialCsvMapping(fileName, rawRows),
  );
  const [fieldMappings, setFieldMappings] = useState<FieldMapping>(
    start.fieldMappings,
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    isDateFormat(start.dateFormat) ? start.dateFormat : 'mm dd yyyy',
  );
  const [flipAmount, setFlipAmount] = useState(start.flipAmount);
  const [splitMode, setSplitMode] = useState(
    Boolean(start.fieldMappings.outflow || start.fieldMappings.inflow),
  );
  const [inOutMode, setInOutMode] = useState(start.inOutMode);
  const [outValue, setOutValue] = useState(start.outValue);
  const [multiplierEnabled, setMultiplierEnabled] = useState(
    start.multiplier !== '',
  );
  const [multiplier, setMultiplier] = useState(start.multiplier);

  const rows = rawRows.map(csvRowRecord);
  const hasHeaderRow = !Array.isArray(rawRows[0]);
  const mapping = buildCsvMapping(
    { ...start.settings, hasHeaderRow },
    {
      fieldMappings,
      dateFormat,
      flipAmount,
      multiplier: multiplierEnabled ? multiplier : '',
      inOutMode,
      outValue,
    },
  );
  const preview = csvToSetupRows(
    'preview',
    rawRows.slice(0, PREVIEW_ROW_COUNT),
    mapping,
  );
  const whole = csvToSetupRows('whole', rawRows, mapping);
  const errorCount = whole.errors.length;
  const balance = whole.balance;

  function onChangeField(field: keyof FieldMapping, name: string) {
    setFieldMappings({
      ...fieldMappings,
      [field]: name === '' || name === 'choose-field' ? null : name,
    });
  }

  function onToggleSplit() {
    const isSplit = !splitMode;
    setSplitMode(isSplit);
    setFieldMappings(
      isSplit
        ? {
            ...fieldMappings,
            amount: null,
            outflow: fieldMappings.amount,
            inflow: null,
          }
        : {
            ...fieldMappings,
            amount: fieldMappings.outflow ?? fieldMappings.inflow,
            outflow: null,
            inflow: null,
          },
    );
  }

  function onChangeMultiplier(value: string) {
    if (!value || /^\d{1,}(\.\d{0,4})?$/.test(value)) {
      setMultiplier(value);
    }
  }

  return (
    <Modal
      name="bank-file-setup-csv-mapping"
      containerProps={{ style: { width: 800 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Columns in {{fileName}}', { fileName })}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />

          <FieldMappings
            transactions={rows}
            mappings={fieldMappings}
            onChange={onChangeField}
            splitMode={splitMode}
            inOutMode={inOutMode}
            hasHeaderRow={hasHeaderRow}
            showBalance
            showCategory={false}
          />

          <SpaceBetween
            gap={20}
            style={{ marginTop: 10, alignItems: 'flex-start' }}
          >
            <DateFormatSelect
              transactions={rows}
              fieldMappings={fieldMappings}
              parseDateFormat={dateFormat}
              onChange={value => {
                if (isDateFormat(value)) {
                  setDateFormat(value);
                }
              }}
            />
            <View style={{ gap: 5 }}>
              <SectionLabel title={t('AMOUNT OPTIONS')} />
              <LabeledCheckbox
                id="setup_csv_flip"
                checked={flipAmount}
                onChange={() => setFlipAmount(!flipAmount)}
              >
                <Trans>Flip amount</Trans>
              </LabeledCheckbox>
              <MultiplierOption
                multiplierEnabled={multiplierEnabled}
                multiplierAmount={multiplier}
                onToggle={() => {
                  setMultiplierEnabled(!multiplierEnabled);
                  setMultiplier('');
                }}
                onChangeAmount={onChangeMultiplier}
              />
              <LabeledCheckbox
                id="setup_csv_split"
                checked={splitMode}
                onChange={onToggleSplit}
              >
                <Trans>Split amount into separate inflow/outflow columns</Trans>
              </LabeledCheckbox>
              <InOutOption
                inOutMode={inOutMode}
                outValue={outValue}
                onToggle={() => setInOutMode(!inOutMode)}
                onChangeText={setOutValue}
              />
            </View>
          </SpaceBetween>

          <SectionLabel title={t('PREVIEW')} style={{ marginTop: 15 }} />
          <View>
            {preview.rows.map(row => (
              <View
                key={row.id}
                data-testid="csv-preview-row"
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  padding: '4px 0',
                  borderBottom: `1px solid ${theme.tableBorder}`,
                }}
              >
                <Text style={{ width: 100 }}>{row.date}</Text>
                <Text style={{ flex: 1 }}>{row.payeeName}</Text>
                <FinancialText style={{ width: 100, textAlign: 'right' }}>
                  {integerToCurrency(row.amount)}
                </FinancialText>
              </View>
            ))}
          </View>
          {balance && (
            <Text style={{ marginTop: 5 }}>
              <Trans>Balance on {{ date: balance.date }}:</Trans>{' '}
              <FinancialText>{integerToCurrency(balance.amount)}</FinancialText>
            </Text>
          )}
          {errorCount > 0 && (
            <Text style={{ marginTop: 5, color: theme.errorText }}>
              <Trans count={errorCount}>
                {{ count: errorCount }} rows could not be read.
              </Trans>{' '}
              {whole.errors[0]}
            </Text>
          )}

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 15,
            }}
          >
            <Button onPress={() => state.close()}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="primary"
              onPress={() => {
                onDone(mapping);
                state.close();
              }}
            >
              <Trans>Done</Trans>
            </Button>
          </View>
        </>
      )}
    </Modal>
  );
}
```

Done stays enabled when rows fail to parse. The page, not the modal, decides whether the file still "Needs columns", and a file with one unreadable footer line should not trap the person in the modal.

- [ ] **Step 17: Run it to verify it passes**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/ src/components/modals/ImportTransactionsModal/`
Expected: PASS: `CsvMappingModal.test.tsx` 3 tests, `csvRows.test.ts` 10, `importSettings.test.ts` 8, `FieldMappings.test.tsx` 4, `utils.test.ts` with the 4 new tests.

- [ ] **Step 18: Typecheck, lint and commit**

```bash
yarn typecheck
yarn lint:fix
git add packages/desktop-client/package.json packages/desktop-client/src/components/modals/ImportTransactionsModal/importSettings.ts packages/desktop-client/src/components/modals/ImportTransactionsModal/importSettings.test.ts packages/desktop-client/src/components/modals/ImportTransactionsModal/ImportTransactionsModal.tsx packages/desktop-client/src/components/modals/ImportTransactionsModal/utils.ts packages/desktop-client/src/components/modals/ImportTransactionsModal/utils.test.ts packages/desktop-client/src/components/modals/ImportTransactionsModal/FieldMappings.tsx packages/desktop-client/src/components/modals/ImportTransactionsModal/FieldMappings.test.tsx packages/desktop-client/src/components/modals/ImportTransactionsModal/SelectField.tsx packages/desktop-client/src/components/modals/ImportTransactionsModal/DateFormatSelect.tsx packages/component-library/src/Select.tsx packages/desktop-client/src/components/bank-file-setup/csvRows.ts packages/desktop-client/src/components/bank-file-setup/csvRows.test.ts packages/desktop-client/src/components/bank-file-setup/csvFixtures.ts packages/desktop-client/src/components/bank-file-setup/CsvMappingModal.tsx packages/desktop-client/src/components/bank-file-setup/CsvMappingModal.test.tsx packages/desktop-client/src/modals/modalsSlice.ts packages/desktop-client/src/components/Modals.tsx
git commit -m "[AI] Map CSV columns for bank file setup without an account"
```

If `yarn typecheck` reports an unused `@ts-expect-error` at the `setFieldMappings(mappings)` line in `ImportTransactionsModal.tsx`, remove that directive. It is expected to stay needed (`Partial<FieldMapping>` is not a `FieldMapping`), but the typecheck is the check.

---

### Task 10: The setup page (direction E)

Covers D1, D2, D5 and D9, UX direction E, and the UX review's adopted items 2 to 8, 10, 12, 13 and 15. Review Focus 2 (client side: the reducer drops answers whose rows are gone or no longer pair) and Review Focus 4 (client side: a second press of Create sends nothing) are pinned here.

Two red/green cycles, one commit: the reducer first, then the page and its components.

**Files:**

- Create: `packages/desktop-client/src/components/bank-file-setup/useSetupDraft.ts`
- Create: `packages/desktop-client/src/components/bank-file-setup/StartChoice.tsx`
- Create: `packages/desktop-client/src/components/bank-file-setup/AccountCard.tsx`
- Create: `packages/desktop-client/src/components/bank-file-setup/ReviewTable.tsx`
- Create: `packages/desktop-client/src/components/bank-file-setup/TransferPairs.tsx`
- Create: `packages/desktop-client/src/components/bank-file-setup/SetupFooter.tsx`
- Create: `packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx`
- Test: `packages/desktop-client/src/components/bank-file-setup/useSetupDraft.test.ts`
- Test: `packages/desktop-client/src/components/bank-file-setup/SetupPage.test.tsx`

**Interfaces:**

- Consumes:
  - Task 2: `ParsedStatement` (with its own `errors: ParseError[]`), `ParseFileResult`, `ParseFileOptions` from `@actual-app/core/server/transactions/import/parse-file`. For OFX, QFX and QBO the file-level `errors` repeat the merged list's row errors, so the card reads `statements` first and treats file-level errors as fatal only when there are no statements. `imported_id` is read through an `in` check.
  - Task 3: `buildReview`, `dedupeAcrossFiles`, `validateTransferPair` and the types `Review`, `ReviewAccount`, `SetupAccountDraft`, `SetupAccountType`, `SetupFile`, `SetupRow`, `TransferPair` from `@actual-app/core/shared/bank-file-setup`. This task relies on Task 3's stated judgment calls: a `'needs-columns'` account has `known`, `starting` and `ending` null; an entered balance is dated on the `ledger-after-end` block's `end`, else the last kept row, else `today`; `ReviewAccount` order equals the input order.
  - Task 7: the `'setup-parse-file'` and `'setup-create'` handlers, typed through `Handlers`, called with `send` from `@actual-app/core/platform/client/connection`.
  - Task 8: `LiveRegion()` and `useAnnounce()` from `#components/LiveRegion`, backed by a module-level store: the page mounts `<LiveRegion />` once and any component calls `useAnnounce()`. The region has `role="status"`, shows the latest message, and clears when it unmounts, so the summary after Create reaches screen readers through the notification.
  - Task 9: `csvToSetupRows(fileId, rawRows, mapping)`, `initialCsvMapping(fileName, rawRows)`, `CsvMapping` and `CsvRawRow` from `./csvRows` (same folder; other packages use `#components/bank-file-setup/csvRows`); `defaultImportSettings(fileName)` from `#components/modals/ImportTransactionsModal/importSettings`; the modal `'bank-file-setup-csv-mapping'` with options `{ fileName, rawRows, initial, onDone }` and a "Done" button, registered in `modalsSlice.ts`. The subpath imports for these `.ts` modules are added by Task 9.
- Produces:

```ts
// useSetupDraft.ts
export type RawCsvRows = CsvRawRow[]; // Task 9's CsvRawRow
export type SetupState; // as in the contract, plus fileErrors (correction 3)
export type SetupAction; // as in the contract, with corrections 1 and 3
export function setupReducer(state: SetupState, action: SetupAction): SetupState;
export const initialSetupState: SetupState;
export function useSetupDraft(): [SetupState, Dispatch<SetupAction>];
export function pairKey(pair: TransferPair): string; // `${outRowId}|${inRowId}`
export function fileHash(fileId: string): string;

// SetupPage.tsx (route element for Task 11)
export function SetupPage(): JSX.Element;
```

- [ ] **Step 1: Write the failing reducer test**

The fixture is a checking statement that pays the card 523.10 on Aug 3 and a card CSV that receives it on Aug 4, so `chk:0` and `card:0` pair. The mapping comes from Task 9's `initialCsvMapping`, so the fixture never spells out `ImportSettings`; the reducer only stores it.

`packages/desktop-client/src/components/bank-file-setup/useSetupDraft.test.ts`:

```ts
import type {
  SetupAccountDraft,
  SetupFile,
  SetupRow,
} from '@actual-app/core/shared/bank-file-setup';

import { initialCsvMapping } from './csvRows';
import { initialSetupState, pairKey, setupReducer } from './useSetupDraft';
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

test('remove-file drops the file with its mapping and raw rows', () => {
  const state = run(
    initialSetupState,
    { type: 'choose-setup', draftId: 'card' },
    { type: 'add-file', draftId: 'card', file: cardFile, rawCsv: cardRaw },
    { type: 'map-csv', fileId: 'card', mapping, rows: cardRows, balance: null },
    { type: 'remove-file', draftId: 'card', fileId: 'card' },
  );
  expect(account(state, 'card').files).toEqual([]);
  expect(state.mappings).toEqual({});
  expect(state.rawCsv).toEqual({});
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/useSetupDraft.test.ts`
Expected: FAIL, `Failed to resolve import "./useSetupDraft"`.

- [ ] **Step 3: Implement the reducer and the shared display helpers**

The helpers at the end (names, type labels, counted phrases, dates) are used by every component in this folder. Counted phrases choose the singular or plural key explicitly, because English runs on natural-language keys with no plural resources, and the summary copy must read "1 account".

`packages/desktop-client/src/components/bank-file-setup/useSetupDraft.ts`:

```ts
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

import type { CsvMapping, CsvRawRow } from './csvRows';

export type RawCsvRows = CsvRawRow[];

export type SetupState = {
  step: 'choice' | 'accounts';
  accounts: SetupAccountDraft[];
  answers: Record<string, 'confirmed' | 'separate'>; // key `${outRowId}|${inRowId}`
  mappings: Record<string, CsvMapping>; // by file id
  rawCsv: Record<string, RawCsvRows>; // by file id
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
      errors?: string[];
    }
  | { type: 'remove-file'; draftId: string; fileId: string }
  | {
      type: 'map-csv';
      fileId: string;
      mapping: CsvMapping;
      rows: SetupRow[];
      balance: { date: string; amount: number } | null;
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
  }
}

export function useSetupDraft() {
  return useReducer(setupReducer, initialSetupState);
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/useSetupDraft.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Write the failing page tests**

Only `send` is mocked, through the repo's `#mocks/connection`; hashing, file reading, `buildReview`, the reducer and the store are real. `currentDay()` is `2017-01-01` under test, so `today` in the Create payload is that date. Each expected amount has its arithmetic in a comment.

`packages/desktop-client/src/components/bank-file-setup/SetupPage.test.tsx`:

```tsx
import { MemoryRouter, Route, Routes } from 'react-router';

import { initServer } from '@actual-app/core/platform/client/connection';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';

import { initialCsvMapping } from './csvRows';
import { SetupPage } from './SetupPage';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

// A card statement with no ledger balance, so the card asks what was owed on
// its last transaction, Sep 10. Rows: +523.10 on Aug 4, -40.00 on Sep 10.
const cardStatement = {
  kind: 'credit',
  org: 'Chase',
  fid: '10898',
  bankId: null,
  accountId: '4400110937',
  accountType: null,
  start: '2026-08-01',
  end: '2026-09-10',
  ledgerBalance: null,
  ledgerDate: null,
  transactions: [
    {
      amount: 523.1,
      date: '2026-08-04',
      payee_name: 'Payment Thank You',
      imported_payee: 'Payment Thank You',
      notes: null,
      imported_id: 'c1',
    },
    {
      amount: -40,
      date: '2026-09-10',
      payee_name: 'Coffee',
      imported_payee: 'Coffee',
      notes: null,
      imported_id: 'c2',
    },
  ],
  errors: [],
};

// The same card with one row whose amount the parser could not read. The
// file-level errors repeat it, as they do for OFX (they come from the merged
// list), and must not make the whole file unreadable.
const unreadable = {
  message: 'Invalid amount format: N/A',
  internal: 'Failed to parse amount: N/A',
};
const badCardStatement = {
  ...cardStatement,
  accountId: '4400119999',
  errors: [unreadable],
};

// A checking statement whose ledger balance is dated on its end, so no
// question. Rows: -523.10 on Aug 3 (the card payment), +1,000.00 on Sep 1.
const checkingStatement = {
  kind: 'bank',
  org: 'Chase',
  fid: '10898',
  bankId: '322271627',
  accountId: '000123454821',
  accountType: 'CHECKING',
  start: '2026-08-01',
  end: '2026-09-26',
  ledgerBalance: 2410.55,
  ledgerDate: '2026-09-26',
  transactions: [
    {
      amount: -523.1,
      date: '2026-08-03',
      payee_name: 'Payment to Chase card',
      imported_payee: 'Payment to Chase card',
      notes: null,
      imported_id: 'k1',
    },
    {
      amount: 1000,
      date: '2026-09-01',
      payee_name: 'Payroll',
      imported_payee: 'Payroll',
      notes: null,
      imported_id: 'k2',
    },
  ],
  errors: [],
};

// Aug 14 reads only as month first, so the guessed date format is certain
const csvRows = [
  {
    'Transaction Date': '08/14/2026',
    Description: 'Payment Thank You',
    Amount: '523.10',
  },
];

function parseFile(args: unknown) {
  const name =
    typeof args === 'object' && args !== null && 'name' in args
      ? args.name
      : null;
  switch (name) {
    case 'card.qfx':
      return { errors: [], transactions: [], statements: [cardStatement] };
    case 'checking.qfx':
      return { errors: [], transactions: [], statements: [checkingStatement] };
    case 'bad-card.qfx':
      return {
        errors: [unreadable],
        transactions: [],
        statements: [badCardStatement],
      };
    case 'activity.csv':
      return { errors: [], transactions: csvRows };
    default:
      return { errors: [{ message: 'Unknown fixture', internal: '' }] };
  }
}

function serve(
  create: (input: unknown) => unknown = () => ({
    ok: true,
    accountIds: [],
    transactionCount: 0,
  }),
) {
  const parse = vi.fn(parseFile);
  initServer({ 'setup-parse-file': parse, 'setup-create': create });
  return parse;
}

function renderPage() {
  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  render(
    <TestProviders store={store} queryClient={queryClient}>
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route
            path="/categories/uncategorized"
            element={<p>Uncategorized list</p>}
          />
          <Route path="/budget" element={<p>Budget page</p>} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
  return store;
}

async function chooseSetup() {
  await userEvent.click(
    screen.getByRole('button', { name: /^Set up from bank files/ }),
  );
  expect(
    screen.getByRole('heading', { name: 'Your accounts' }),
  ).toBeInTheDocument();
}

function cards() {
  return screen.getAllByTestId('setup-account-card');
}

function reason() {
  const element = document.getElementById('setup-footer-reason');
  if (!element) {
    throw new Error('No footer reason');
  }
  return element;
}

async function upload(card: HTMLElement, name: string, content: string) {
  const input = card.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('No file input in the card');
  }
  await userEvent.upload(input, new File([content], name));
}

async function fillAccount(card: HTMLElement, name: string, balance: string) {
  await userEvent.type(
    within(card).getByRole('textbox', { name: 'Account name' }),
    name,
  );
  await userEvent.type(
    within(card).getByRole('textbox', { name: 'What is the balance today?' }),
    `${balance}{Enter}`,
  );
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

test('starts with the choice, and starting empty goes to the budget', async () => {
  serve();
  renderPage();
  expect(
    screen.getByRole('heading', { name: 'How do you want to start?' }),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: /^Start with an empty budget/ }),
  );
  expect(screen.getByText('Budget page')).toBeInTheDocument();
});

test('setting up opens one empty account card and the review', async () => {
  serve();
  renderPage();
  await chooseSetup();
  expect(cards()).toHaveLength(1);
  expect(
    within(cards()[0]).getByRole('heading', { name: 'Account 1' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'What will be created' }),
  ).toBeInTheDocument();
});

test('a blocked Create stays focusable and moves focus to the first blocker', async () => {
  const create = vi.fn();
  serve(create);
  renderPage();
  await chooseSetup();

  const button = screen.getByRole('button', { name: 'Create' });
  expect(button).toBeEnabled();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAttribute('aria-describedby', 'setup-footer-reason');
  expect(reason()).toHaveTextContent(
    'Before you can create: Account 1 needs a name.',
  );

  await userEvent.click(button);
  const name = screen.getByRole('textbox', { name: 'Account name' });
  expect(name).toHaveFocus();

  await userEvent.type(name, 'Cash');
  expect(reason()).toHaveTextContent(
    'Before you can create: Cash needs a balance.',
  );
  await userEvent.click(button);
  const balance = screen.getByRole('textbox', {
    name: 'What is the balance today?',
  });
  expect(balance).toHaveFocus();

  // The account named in the reason is a link to the same control
  await userEvent.click(within(reason()).getByRole('button', { name: 'Cash' }));
  expect(balance).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
});

test('entering an amount owed keeps focus and announces the starting balance', async () => {
  serve();
  renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'card.qfx', 'card statement');
  const owed = await within(card).findByRole('textbox', {
    name: 'How much did you owe on September 10?',
  });
  expect(
    within(card).getByRole('textbox', { name: 'Account name' }),
  ).toHaveValue('Chase Card ••0937');
  expect(within(card).getByRole('textbox', { name: 'Bank' })).toHaveValue(
    'Chase',
  );
  expect(within(card).getByText('Needs a balance')).toBeInTheDocument();

  await userEvent.type(owed, '1126.48{Enter}');

  expect(owed).toHaveFocus();
  // Known -1,126.48 on Sep 10, less the net of +523.10 and -40.00 (483.10)
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Chase Card ••0937: starting balance 1,609.58 owed on Aug 4.',
    ),
  );
  const table = screen.getByRole('table', { name: 'What will be created' });
  expect(within(table).getByText('1,609.58 owed')).toBeInTheDocument();
  // Ending: -1,609.58 + 483.10
  expect(within(table).getByText('1,126.48 owed')).toBeInTheDocument();
  expect(within(card).queryByText('Needs a balance')).toBeNull();
});

test('a CSV needs its columns mapped, and the mapping fills the card', async () => {
  const parse = serve();
  const store = renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'activity.csv', 'Transaction Date,Description,Amount');
  expect(await within(card).findByText('Needs columns')).toBeInTheDocument();
  // Without a header row the parser returns bare string arrays
  expect(parse).toHaveBeenCalledWith({
    name: 'activity.csv',
    bytes: expect.any(Uint8Array),
    options: { hasHeaderRow: true, delimiter: ',' },
  });
  expect(
    within(card).getByText(
      'Tell Actual which columns in activity.csv hold the date, description and amount.',
    ),
  ).toBeInTheDocument();
  expect(
    within(card).getByText('1 row found · columns not mapped yet'),
  ).toBeInTheDocument();

  await userEvent.click(
    within(card).getByRole('button', { name: /^Map columns/ }),
  );
  const modal = store.getState().modals.modalStack.at(-1);
  if (modal?.name !== 'bank-file-setup-csv-mapping') {
    throw new Error('The column mapping did not open');
  }
  expect(modal.options.fileName).toBe('activity.csv');
  expect(modal.options.rawRows).toEqual(csvRows);
  const initial = modal.options.initial;
  expect(initial).toEqual(initialCsvMapping('activity.csv', csvRows));
  if (initial === null) {
    throw new Error('No initial mapping');
  }

  // What the modal's Done does: hand back a mapping
  await act(async () => modal.options.onDone(initial));

  expect(within(card).queryByText('Needs columns')).toBeNull();
  expect(within(card).getByText('1 transaction, Aug 14')).toBeInTheDocument();
  expect(
    within(card).getByRole('textbox', {
      name: 'What was the balance on August 14?',
    }),
  ).toHaveFocus();
});

test('the same file added twice is refused with a message', async () => {
  serve();
  renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'card.qfx', 'card statement');
  await within(card).findByRole('textbox', {
    name: 'How much did you owe on September 10?',
  });
  await upload(card, 'card.qfx', 'card statement');

  expect(
    await within(card).findByText(
      'card.qfx was already added to Chase Card ••0937.',
    ),
  ).toBeInTheDocument();
  expect(within(card).getAllByText('card.qfx')).toHaveLength(1);
});

test('a statement with unreadable rows blocks Create until its file is removed', async () => {
  const create = vi.fn();
  serve(create);
  renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'bad-card.qfx', 'bad card statement');

  expect(
    await within(card).findByText('Fix or remove this file'),
  ).toBeInTheDocument();
  expect(
    within(card).getByText(
      '1 row could not be read: Invalid amount format: N/A',
    ),
  ).toBeInTheDocument();
  expect(reason()).toHaveTextContent(
    'Before you can create: Chase Card ••9999 has a file to fix or remove.',
  );

  const button = screen.getByRole('button', { name: 'Create' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(button);
  const remove = within(card).getByRole('button', {
    name: 'Remove bad-card.qfx',
  });
  expect(remove).toHaveFocus();
  expect(create).not.toHaveBeenCalled();

  await userEvent.click(remove);
  expect(within(card).queryByText('Fix or remove this file')).toBeNull();
  expect(reason()).toHaveTextContent(
    'Before you can create: Chase Card ••9999 needs a balance.',
  );
});

test('a confirmed transfer is sent with Create', async () => {
  const create = vi.fn(() => ({
    ok: true,
    accountIds: ['card', 'checking'],
    transactionCount: 4,
  }));
  serve(create);
  renderPage();
  await chooseSetup();

  await upload(cards()[0], 'card.qfx', 'card statement');
  const owed = await within(cards()[0]).findByRole('textbox', {
    name: 'How much did you owe on September 10?',
  });
  await userEvent.type(owed, '1126.48{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
  await upload(cards()[1], 'checking.qfx', 'checking statement');

  const confirm = await screen.findByRole('button', {
    name: 'Confirm transfer of 523.10 from Chase Checking ••4821 to Chase Card ••0937, Aug 3',
  });
  // Ledger 2,410.55 on Sep 26, less the net of -523.10 and +1,000.00 (476.90)
  expect(
    within(
      screen.getByRole('table', { name: 'What will be created' }),
    ).getByText('1,933.65'),
  ).toBeInTheDocument();
  expect(reason()).toHaveTextContent(
    '2 accounts and 4 transactions will be created. 1 likely transfer not answered: it will be imported as two transactions.',
  );

  await userEvent.click(confirm);
  expect(screen.getByRole('button', { name: /^Change/ })).toHaveFocus();
  expect(reason()).toHaveTextContent(
    /^2 accounts and 4 transactions will be created\.$/,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    accounts: [
      expect.objectContaining({
        name: 'Chase Card ••0937',
        type: 'credit',
        entered: 112648,
      }),
      expect.objectContaining({
        name: 'Chase Checking ••4821',
        type: 'checking',
        entered: null,
      }),
    ],
    confirmedPairs: [
      {
        outRowId: `${await sha256('checking statement')}:0`,
        inRowId: `${await sha256('card statement')}:0`,
      },
    ],
    today: '2017-01-01',
  });
});

test('pressing Create twice sends one request (Review Focus 4)', async () => {
  let finish: (result: unknown) => void = () => {};
  const create = vi.fn(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  serve(create);
  renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');

  const button = screen.getByRole('button', { name: 'Create' });
  expect(button).toHaveAttribute('aria-disabled', 'false');

  await userEvent.dblClick(button);
  expect(button).toHaveTextContent('Creating…');
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('textbox', { name: 'Account name' })).toBeDisabled();
  await userEvent.click(button);

  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    accounts: [
      {
        id: expect.any(String),
        name: 'Cash',
        bank: '',
        type: 'checking',
        offbudget: false,
        files: [],
        entered: 5000,
      },
    ],
    confirmedPairs: [],
    today: '2017-01-01',
  });

  await act(async () =>
    finish({ ok: true, accountIds: ['cash'], transactionCount: 0 }),
  );
  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
});

test('Create posts the summary and opens the uncategorized list', async () => {
  // The summary counts what the server reports it created
  serve(() => ({
    ok: true,
    accountIds: ['cash', 'savings'],
    transactionCount: 486,
  }));
  const store = renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');
  await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
  await fillAccount(cards()[1], 'Savings', '1000');
  expect(reason()).toHaveTextContent(
    '2 accounts and 0 transactions will be created.',
  );

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
  expect(
    store.getState().notifications.notifications.map(n => n.message),
  ).toEqual([
    'Created 2 accounts and 486 transactions. They are uncategorized; start with the ones below. Past months will look overspent because nothing was budgeted in them.',
  ]);
});

test('Create with a warning still opens the list and adds a second notice', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  serve(() => ({
    ok: true,
    accountIds: ['cash'],
    transactionCount: 0,
    warning: 'Failed to save import settings',
  }));
  const store = renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
  expect(
    store
      .getState()
      .notifications.notifications.map(({ type, message, sticky }) => ({
        type,
        message,
        sticky,
      })),
  ).toEqual([
    {
      type: 'message',
      message:
        'Created 1 account and 0 transactions. They are uncategorized; start with the ones below. Past months will look overspent because nothing was budgeted in them.',
      sticky: undefined,
    },
    {
      type: 'warning',
      message:
        'Everything was created, but a step after saving did not finish. Your accounts and transactions are safe.',
      sticky: undefined,
    },
  ]);
  expect(log).toHaveBeenCalledWith(
    'Bank file setup warning:',
    'Failed to save import settings',
  );
  log.mockRestore();
});

test('a failed Create shows the error and keeps the draft', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  serve(() => ({ ok: false, error: 'Disk full' }));
  renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  // The server's message is English and technical; the page shows its own
  await waitFor(() =>
    expect(document.getElementById('setup-create-error')).toHaveTextContent(
      'Nothing was created. Check the accounts and try again.',
    ),
  );
  expect(log).toHaveBeenCalledWith('Bank file setup failed:', 'Disk full');
  log.mockRestore();
  const name = screen.getByRole('textbox', { name: 'Account name' });
  expect(name).toHaveValue('Cash');
  expect(name).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
});

test('Close setup asks before leaving once an account exists', async () => {
  serve();
  renderPage();
  await chooseSetup();

  await userEvent.click(screen.getByRole('button', { name: 'Close setup' }));
  expect(
    screen.getByText(
      'Leave setup? The accounts you added have not been created.',
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Leave setup' }));
  expect(screen.getByText('Budget page')).toBeInTheDocument();
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/SetupPage.test.tsx`
Expected: FAIL, `Failed to resolve import "./SetupPage"`.

- [ ] **Step 7: Implement the choice**

`packages/desktop-client/src/components/bank-file-setup/StartChoice.tsx`. Each option is one button holding its title and description, so its accessible name starts with the title.

```tsx
import type { ReactNode } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

type StartChoiceProps = {
  onSetUp: () => void;
  onStartEmpty: () => void;
};

export function StartChoice({ onSetUp, onStartEmpty }: StartChoiceProps) {
  return (
    <View
      style={{
        width: '100%',
        maxWidth: 640,
        margin: '0 auto',
        padding: '64px 16px',
        gap: 16,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: 28,
          fontWeight: 600,
          color: theme.pageText,
        }}
      >
        <Trans>How do you want to start?</Trans>
      </h1>
      <ChoiceButton
        isPrimary
        title={<Trans>Set up from bank files</Trans>}
        description={
          <Trans>
            Add your accounts and the files you downloaded from your banks.
            Nothing is created until you confirm.
          </Trans>
        }
        onPress={onSetUp}
      />
      <ChoiceButton
        title={<Trans>Start with an empty budget</Trans>}
        description={
          <Trans>
            Add accounts yourself. You can still set up from bank files later.
          </Trans>
        }
        onPress={onStartEmpty}
      />
    </View>
  );
}

type ChoiceButtonProps = {
  title: ReactNode;
  description: ReactNode;
  isPrimary?: boolean;
  onPress: () => void;
};

function ChoiceButton({
  title,
  description,
  isPrimary = false,
  onPress,
}: ChoiceButtonProps) {
  return (
    <Button
      onPress={onPress}
      style={{
        justifyContent: 'flex-start',
        textAlign: 'left',
        padding: 20,
        borderRadius: 6,
        backgroundColor: theme.tableBackground,
        border: `1px solid ${isPrimary ? theme.buttonPrimaryBackground : theme.tableBorder}`,
      }}
    >
      <View style={{ gap: 4, alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 16, fontWeight: 600, color: theme.pageText }}>
          {title}
        </Text>
        <Text style={{ color: theme.pageTextSubdued, lineHeight: 1.4 }}>
          {description}
        </Text>
      </View>
    </Button>
  );
}
```

- [ ] **Step 8: Implement the footer**

`packages/desktop-client/src/components/bank-file-setup/SetupFooter.tsx`. Create is a native `<button>`: react-aria's `Button` drops `aria-disabled` (its `filterDOMProps` passes only id and labelling props), and a blocked Create must stay focusable with `aria-disabled="true"`. The page guards against a second press; this component only renders the state.

```tsx
import { Fragment, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { css } from '@emotion/css';
import type { TFunction } from 'i18next';

import { accountsText, transactionsText } from './useSetupDraft';

export type SetupBlocker = {
  draftId: string;
  accountName: string;
  reason: 'name' | 'file' | 'columns' | 'balance';
  targetId: string; // the DOM id of the control that resolves it
};

export const FOOTER_REASON_ID = 'setup-footer-reason';

type SetupFooterProps = {
  accountCount: number;
  transactionCount: number;
  blockers: SetupBlocker[];
  unanswered: number;
  creating: boolean;
  error: string | null;
  onCreate: () => void;
  onFocusBlocker: (targetId: string) => void;
  onLeave: () => void;
};

export function SetupFooter({
  accountCount,
  transactionCount,
  blockers,
  unanswered,
  creating,
  error,
  onCreate,
  onFocusBlocker,
  onLeave,
}: SetupFooterProps) {
  const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);
  const isUnavailable = accountCount === 0 || blockers.length > 0 || creating;

  return (
    <View
      style={{
        gap: 10,
        padding: '12px 16px',
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
      }}
    >
      {error !== null ? (
        <Text id="setup-create-error" style={{ color: theme.errorText }}>
          <Trans>Nothing was created. Check the accounts and try again.</Trans>
        </Text>
      ) : null}
      {isConfirmingLeave ? (
        <View style={rowStyle}>
          <Text style={{ flex: 1 }}>
            <Trans>
              Leave setup? The accounts you added have not been created.
            </Trans>
          </Text>
          <Button autoFocus onPress={() => setIsConfirmingLeave(false)}>
            <Trans>Keep editing</Trans>
          </Button>
          <Button onPress={onLeave}>
            <Trans>Leave setup</Trans>
          </Button>
        </View>
      ) : null}
      <View style={rowStyle}>
        <Text id={FOOTER_REASON_ID} style={{ flex: 1, lineHeight: 1.4 }}>
          <Reason
            accountCount={accountCount}
            transactionCount={transactionCount}
            blockers={blockers}
            unanswered={unanswered}
            onFocusBlocker={onFocusBlocker}
          />
        </Text>
        <Button
          isDisabled={creating}
          onPress={() => {
            if (accountCount > 0) {
              setIsConfirmingLeave(true);
            } else {
              onLeave();
            }
          }}
        >
          <Trans>Close setup</Trans>
        </Button>
        <button
          type="button"
          aria-disabled={isUnavailable}
          aria-describedby={FOOTER_REASON_ID}
          className={createButtonClassName(isUnavailable)}
          onClick={onCreate}
        >
          {creating ? <Trans>Creating…</Trans> : <Trans>Create</Trans>}
        </button>
      </View>
    </View>
  );
}

type ReasonProps = Pick<
  SetupFooterProps,
  | 'accountCount'
  | 'transactionCount'
  | 'blockers'
  | 'unanswered'
  | 'onFocusBlocker'
>;

function Reason({
  accountCount,
  transactionCount,
  blockers,
  unanswered,
  onFocusBlocker,
}: ReasonProps) {
  const { t } = useTranslation();

  if (accountCount === 0) {
    return <Trans>Add an account before you create.</Trans>;
  }

  if (blockers.length > 0) {
    return (
      <>
        <Trans>Before you can create:</Trans>{' '}
        {blockers.map((blocker, index) => (
          <Fragment key={blocker.draftId}>
            {index > 0 ? ', ' : null}
            <Button
              variant="bare"
              style={inlineLinkStyle}
              onPress={() => onFocusBlocker(blocker.targetId)}
            >
              {blocker.accountName}
            </Button>{' '}
            {blockerText(blocker.reason, t)}
          </Fragment>
        ))}
        .
      </>
    );
  }

  return (
    <>
      {t('{{accounts}} and {{transactions}} will be created.', {
        accounts: accountsText(accountCount, t),
        transactions: transactionsText(transactionCount, t),
      })}
      {unanswered > 0 ? ` ${unansweredText(unanswered, t)}` : null}
    </>
  );
}

function blockerText(reason: SetupBlocker['reason'], t: TFunction): string {
  switch (reason) {
    case 'name':
      return t('needs a name');
    case 'file':
      return t('has a file to fix or remove');
    case 'columns':
      return t('needs columns');
    case 'balance':
      return t('needs a balance');
  }
}

function unansweredText(count: number, t: TFunction): string {
  return count === 1
    ? t(
        '{{count}} likely transfer not answered: it will be imported as two transactions.',
        { count },
      )
    : t(
        '{{count}} likely transfers not answered: each will be imported as two transactions.',
        { count },
      );
}

function createButtonClassName(isUnavailable: boolean) {
  return css({
    ...styles.smallText,
    flexShrink: 0,
    padding: '6px 16px',
    borderRadius: 4,
    cursor: isUnavailable ? 'default' : 'pointer',
    border: `1px solid ${isUnavailable ? theme.buttonPrimaryDisabledBorder : theme.buttonPrimaryBorder}`,
    backgroundColor: isUnavailable
      ? theme.buttonPrimaryDisabledBackground
      : theme.buttonPrimaryBackground,
    color: isUnavailable
      ? theme.buttonPrimaryDisabledText
      : theme.buttonPrimaryText,
    '&:focus-visible': {
      outline: `2px solid ${theme.buttonPrimaryBackground}`,
      outlineOffset: 2,
    },
  });
}

const rowStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
} as const;

const inlineLinkStyle = {
  display: 'inline',
  padding: 0,
  color: theme.pageTextLink,
  textDecoration: 'underline',
};
```

- [ ] **Step 9: Implement the review table**

`packages/desktop-client/src/components/bank-file-setup/ReviewTable.tsx`. A semantic table named by the section heading. An incomplete row shows its state in Slate text, not gold (UX review 5 and 14). Cards always read "owed" (UX review 10).

```tsx
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type {
  Review,
  ReviewAccount,
  SetupAccountDraft,
  SetupAccountType,
} from '@actual-app/core/shared/bank-file-setup';
import { css } from '@emotion/css';
import type { TFunction } from 'i18next';

import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import type { UseFormatResult } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import {
  accountDisplayName,
  accountTypeLabel,
  shortDate,
} from './useSetupDraft';

type ReviewTableProps = {
  accounts: SetupAccountDraft[];
  review: Review;
  labelledBy: string;
};

export function ReviewTable({
  accounts,
  review,
  labelledBy,
}: ReviewTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <table aria-labelledby={labelledBy} className={tableClassName}>
      <thead>
        <tr>
          <th scope="col">
            <Trans>Account</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Transactions</Trans>
          </th>
          <th scope="col">
            <Trans>Dates</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Duplicates</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Starting balance</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Ending balance</Trans>
          </th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account, index) => {
          const reviewed = review.accounts[index];
          if (!reviewed) {
            return null;
          }
          return (
            <ReviewRows
              key={account.id}
              account={account}
              index={index}
              reviewed={reviewed}
              isExpanded={expanded === account.id}
              onToggle={() =>
                setExpanded(expanded === account.id ? null : account.id)
              }
            />
          );
        })}
      </tbody>
    </table>
  );
}

export function formatBalance(
  format: UseFormatResult,
  amount: number,
  type: SetupAccountType,
  t: TFunction,
): string {
  if (type === 'credit' && amount <= 0) {
    return t('{{amount}} owed', {
      amount: format(Math.abs(amount), 'financial'),
    });
  }
  return format(amount, 'financial');
}

type ReviewRowsProps = {
  account: SetupAccountDraft;
  index: number;
  reviewed: ReviewAccount;
  isExpanded: boolean;
  onToggle: () => void;
};

function ReviewRows({
  account,
  index,
  reviewed,
  isExpanded,
  onToggle,
}: ReviewRowsProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const name = accountDisplayName(account, index, t);
  const detailsId = `setup-skipped-${account.id}`;
  const details = [account.bank.trim(), accountTypeLabel(account.type, t)]
    .filter(part => part !== '')
    .join(' · ');

  return (
    <>
      <tr
        style={
          reviewed.block !== null ? { color: theme.pageTextSubdued } : undefined
        }
      >
        <th scope="row" style={{ fontWeight: 400 }}>
          <div>{name}</div>
          <div style={smallSubdued}>{details}</div>
        </th>
        <td style={numeric}>
          {reviewed.block === 'needs-columns' ? (
            <>
              <span aria-hidden="true">?</span>
              <Text style={styles.visuallyHidden}>
                <Trans>Not known until the columns are mapped</Trans>
              </Text>
            </>
          ) : (
            <FinancialText>{reviewed.rows.length}</FinancialText>
          )}
        </td>
        <td>{datesText(account, reviewed, t, locale)}</td>
        <td style={numeric}>
          {reviewed.skipped.length > 0 ? (
            <Button
              variant="bare"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              style={linkStyle}
              onPress={onToggle}
            >
              {t('{{count}} skipped', { count: reviewed.skipped.length })}
            </Button>
          ) : (
            <FinancialText>0</FinancialText>
          )}
        </td>
        <td style={numeric}>
          {reviewed.starting ? (
            <>
              <FinancialText>
                {formatBalance(
                  format,
                  reviewed.starting.amount,
                  account.type,
                  t,
                )}
              </FinancialText>
              <div style={smallSubdued}>
                {shortDate(reviewed.starting.date, locale)}
              </div>
            </>
          ) : (
            <Text>
              {reviewed.block === 'needs-columns'
                ? t('Needs columns')
                : t('Needs a balance')}
            </Text>
          )}
        </td>
        <td style={numeric}>
          {reviewed.ending !== null ? (
            <FinancialText>
              {formatBalance(format, reviewed.ending, account.type, t)}
            </FinancialText>
          ) : null}
        </td>
      </tr>
      {isExpanded ? (
        <tr id={detailsId}>
          <td colSpan={6}>
            <Text style={smallSubdued}>
              {t('In more than one file for {{name}}, so imported once:', {
                name,
              })}
            </Text>
            <table className={skippedTableClassName}>
              <tbody>
                {reviewed.skipped.map(({ row }) => (
                  <tr key={row.id}>
                    <td>{shortDate(row.date, locale)}</td>
                    <td>{row.payeeName}</td>
                    <td style={numeric}>
                      <FinancialText>
                        {format(row.amount, 'financial')}
                      </FinancialText>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function datesText(
  account: SetupAccountDraft,
  reviewed: ReviewAccount,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  if (account.files.length === 0) {
    return t('No files');
  }
  if (reviewed.from === null || reviewed.to === null) {
    return t('No transactions');
  }
  return t('{{from}} to {{to}}', {
    from: shortDate(reviewed.from, locale),
    to: shortDate(reviewed.to, locale),
  });
}

const numeric = { textAlign: 'right' } satisfies CSSProperties;

const smallSubdued = {
  fontSize: 12,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

const linkStyle = {
  display: 'inline',
  padding: 0,
  color: theme.pageTextLink,
  textDecoration: 'underline',
} satisfies CSSProperties;

const tableClassName = css({
  width: '100%',
  borderCollapse: 'collapse',
  backgroundColor: theme.tableBackground,
  border: `1px solid ${theme.tableBorder}`,
  color: theme.pageText,
  fontSize: 13,
  '& th, & td': {
    padding: '8px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
    borderTop: `1px solid ${theme.tableBorder}`,
  },
  '& thead th': {
    fontWeight: 400,
    color: theme.pageTextSubdued,
    borderTop: 'none',
  },
});

const skippedTableClassName = css({
  marginTop: 4,
  borderCollapse: 'collapse',
  '& td': { padding: '2px 12px 2px 0', border: 'none' },
});
```

- [ ] **Step 10: Implement the transfer pairs**

`packages/desktop-client/src/components/bank-file-setup/TransferPairs.tsx`. Pairs are the review's `candidatePairs`; each row names the pair in a visually hidden label on its buttons (UX review 8) and says "from" and "to" instead of a sign (UX review 10). The ids let the page keep focus when the buttons swap for "Change".

```tsx
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  Review,
  SetupAccountDraft,
  SetupRow,
  TransferPair,
} from '@actual-app/core/shared/bank-file-setup';
import { css } from '@emotion/css';

import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { accountDisplayName, pairKey, shortDate } from './useSetupDraft';
import type { SetupState } from './useSetupDraft';

type TransferPairsProps = {
  pairs: TransferPair[];
  answers: SetupState['answers'];
  accounts: SetupAccountDraft[];
  review: Review;
  onAnswer: (
    pair: TransferPair,
    answer: 'confirmed' | 'separate' | null,
  ) => void;
};

export function TransferPairs({
  pairs,
  answers,
  accounts,
  review,
  onAnswer,
}: TransferPairsProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();

  const rowsById = new Map<string, { draftId: string; row: SetupRow }>();
  for (const reviewed of review.accounts) {
    for (const row of reviewed.rows) {
      rowsById.set(row.id, { draftId: reviewed.draftId, row });
    }
  }

  function nameOf(draftId: string) {
    const index = accounts.findIndex(account => account.id === draftId);
    return index < 0 ? '' : accountDisplayName(accounts[index], index, t);
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <h2 id="setup-transfers-heading" style={headingStyle}>
          <Trans>Likely transfers</Trans>
        </h2>
        <Text style={smallSubdued}>
          {pairs.length === 1
            ? t('{{count}} pair', { count: 1 })
            : t('{{count}} pairs', { count: pairs.length })}
        </Text>
      </View>
      <View
        style={{
          gap: 10,
          padding: 16,
          backgroundColor: theme.tableBackground,
          border: `1px solid ${theme.tableBorder}`,
          borderRadius: 6,
        }}
      >
        <Text style={{ color: theme.pageTextSubdued, lineHeight: 1.4 }}>
          <Trans>
            The same amount leaving one of your accounts and arriving in
            another. A confirmed pair becomes a transfer, so it is not counted
            as spending and income.
          </Trans>
        </Text>
        <table
          aria-labelledby="setup-transfers-heading"
          className={tableClassName}
        >
          <thead>
            <tr>
              <th scope="col" style={numeric}>
                <Trans>Amount</Trans>
              </th>
              <th scope="col">
                <Trans>From</Trans>
              </th>
              <th scope="col">
                <Trans>To</Trans>
              </th>
              <th scope="col">
                <Trans>Dates</Trans>
              </th>
              <th scope="col">
                <Text style={styles.visuallyHidden}>
                  <Trans>Answer</Trans>
                </Text>
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(pair => {
              const out = rowsById.get(pair.outRowId);
              const into = rowsById.get(pair.inRowId);
              if (!out || !into) {
                return null;
              }
              const key = pairKey(pair);
              const answer = answers[key];
              const amount = format(Math.abs(out.row.amount), 'financial');
              const from = nameOf(out.draftId);
              const to = nameOf(into.draftId);
              const label = t('{{amount}} from {{from}} to {{to}}, {{date}}', {
                amount,
                from,
                to,
                date: shortDate(out.row.date, locale),
              });
              const dates =
                out.row.date === into.row.date
                  ? shortDate(out.row.date, locale)
                  : t('{{first}} and {{second}}', {
                      first: shortDate(out.row.date, locale),
                      second: shortDate(into.row.date, locale),
                    });

              return (
                <tr key={key}>
                  <td style={numeric}>
                    <FinancialText>{amount}</FinancialText>
                  </td>
                  <td>
                    <div>{from}</div>
                    <div style={smallSubdued}>{out.row.payeeName}</div>
                  </td>
                  <td>
                    <div>{to}</div>
                    <div style={smallSubdued}>{into.row.payeeName}</div>
                  </td>
                  <td>{dates}</td>
                  <td>
                    {answer === undefined ? (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Button
                          id={`setup-pair-confirm-${key}`}
                          onPress={() => onAnswer(pair, 'confirmed')}
                        >
                          <Trans>Confirm</Trans>
                          <Text style={styles.visuallyHidden}>
                            {' '}
                            {t('transfer of {{label}}', { label })}
                          </Text>
                        </Button>
                        <Button onPress={() => onAnswer(pair, 'separate')}>
                          <Trans>Keep separate</Trans>
                          <Text style={styles.visuallyHidden}>
                            {': '}
                            {label}
                          </Text>
                        </Button>
                      </View>
                    ) : (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Text style={{ color: theme.pageTextSubdued }}>
                          {answer === 'confirmed'
                            ? t('Will be imported as a transfer.')
                            : t('Will be imported as two transactions.')}
                        </Text>
                        <Button
                          id={`setup-pair-change-${key}`}
                          variant="bare"
                          style={{
                            color: theme.pageTextLink,
                            textDecoration: 'underline',
                          }}
                          onPress={() => onAnswer(pair, null)}
                        >
                          <Trans>Change</Trans>
                          <Text style={styles.visuallyHidden}>
                            {' '}
                            {t('answer for {{label}}', { label })}
                          </Text>
                        </Button>
                      </View>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </View>
    </View>
  );
}

const headingStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: theme.pageText,
} satisfies CSSProperties;

const numeric = { textAlign: 'right' } satisfies CSSProperties;

const smallSubdued = {
  fontSize: 12,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

const tableClassName = css({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  color: theme.pageText,
  '& th, & td': {
    padding: '6px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
    borderTop: `1px solid ${theme.tableBorder}`,
  },
  '& thead th': {
    fontWeight: 400,
    color: theme.pageTextSubdued,
    borderTop: 'none',
  },
});
```

- [ ] **Step 11: Implement the account card and file intake**

`packages/desktop-client/src/components/bank-file-setup/AccountCard.tsx`.

Intake per added `File`: reject an unknown extension; read the bytes; hash them with `crypto.subtle` (SHA-256); refuse a hash already in this batch or any account (`findFileOwner`); send `{ name, bytes, options }` to `'setup-parse-file'`; then by format. OFX, QFX and QBO use `statements`: investment statements are reported as not supported, the first bank or card statement fills this card (only empty fields, and the type only for a card that had no files), and each further statement creates an account. A statement's own `errors` travel with its file (`add-file`'s `errors`); the chip then shows them under a gold "Fix or remove this file" state and the page blocks Create for that account, so a row that parsed as 0 is never imported silently. For these formats the file-level `errors` only repeat the merged list's row errors, so they count as fatal only when no statement came back. CSV and TSV become `needsMapping` files with their raw rows kept, parsed with a header row and the delimiter from Task 9's `defaultImportSettings(name)` (without `hasHeaderRow` the parser returns bare string arrays). QIF goes the same way, because its dates need the date format the mapping asks for, as in the import dialog. CAMT XML rows arrive dated `YYYY-MM-DD` and are used as they are. A file that cannot be read or is refused becomes a removable notice on the card and never blocks Create.

The balance question keeps one element tree whether it is gold ("Needs a balance") or answered, so the input is never remounted and keeps focus when the review updates (UX review 2). The card never collapses (UX review 4).

```tsx
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DropZone, FileTrigger, isFileDropItem } from 'react-aria-components';
import type { DropEvent } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgClose } from '@actual-app/components/icons/v1';
import { SvgAlertTriangle } from '@actual-app/components/icons/v2';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type {
  ParsedStatement,
  ParseFileOptions,
  ParseFileResult,
} from '@actual-app/core/server/transactions/import/parse-file';
import type {
  ReviewAccount,
  SetupAccountDraft,
  SetupAccountType,
  SetupFile,
  SetupRow,
} from '@actual-app/core/shared/bank-file-setup';
import { amountToInteger } from '@actual-app/core/shared/util';
import { css } from '@emotion/css';
import type { TFunction } from 'i18next';
import { v4 as uuidv4 } from 'uuid';

import { Checkbox } from '#components/forms';
import { useAnnounce } from '#components/LiveRegion';
import { defaultImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import {
  accountDisplayName,
  accountTypeLabel,
  longDate,
  shortDate,
  transactionsText,
} from './useSetupDraft';
import type { RawCsvRows, SetupAction, SetupState } from './useSetupDraft';

type AccountCardProps = {
  account: SetupAccountDraft;
  index: number;
  review: ReviewAccount | undefined;
  rawCsv: SetupState['rawCsv'];
  fileErrors: SetupState['fileErrors'];
  findFileOwner: (hash: string) => string | null;
  onAction: (action: SetupAction) => void;
  onMapColumns: (file: SetupFile) => void;
};

export function AccountCard({
  account,
  index,
  review,
  rawCsv,
  fileErrors,
  findFileOwner,
  onAction,
  onMapColumns,
}: AccountCardProps) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const locale = useLocale();
  const [notices, setNotices] = useState<
    Array<{ id: string; name: string; message: string }>
  >([]);

  const id = account.id;
  const headingId = `setup-card-${id}`;
  const displayName = accountDisplayName(account, index, t);
  const typeOptions = (['checking', 'savings', 'credit', 'other'] as const).map(
    type => [type, accountTypeLabel(type, t)] as const,
  );

  const block = review?.block ?? null;
  const balanceBlock =
    block !== null && block !== 'needs-columns' ? block : null;
  const enteredKnown =
    review?.known?.source === 'entered' ? review.known : null;
  const questionDate = balanceBlock
    ? balanceBlock.kind === 'ledger-after-end'
      ? balanceBlock.end
      : balanceBlock.asOf
    : (enteredKnown?.date ?? null);
  const unmapped = account.files.filter(file => file.needsMapping);

  function notify(name: string, message: string) {
    setNotices(current => [...current, { id: uuidv4(), name, message }]);
    announce(message);
  }

  async function addFiles(files: File[]) {
    const seen = new Set<string>();
    let isFilled = account.files.length > 0;

    for (const file of files) {
      const fileFormat = formatOf(file.name);
      if (fileFormat === null) {
        notify(
          file.name,
          t(
            '{{name}} is not a file Actual can read. Use OFX, QFX, QBO, QIF, CSV, TSV or CAMT.053 XML.',
            { name: file.name },
          ),
        );
        continue;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      const owner = seen.has(hash) ? displayName : findFileOwner(hash);
      if (owner !== null) {
        notify(
          file.name,
          t('{{name}} was already added to {{account}}.', {
            name: file.name,
            account: owner,
          }),
        );
        continue;
      }
      seen.add(hash);

      const result = await send('setup-parse-file', {
        name: file.name,
        bytes,
        options: parseOptions(fileFormat, file.name),
      });
      const statements = result.statements ?? [];
      const isOfxFamily =
        fileFormat === 'ofx' || fileFormat === 'qfx' || fileFormat === 'qbo';

      // An OFX file's own errors repeat its statements' row errors, which
      // the statements carry; they are fatal only when no statement came back
      if (result.errors.length > 0 && !(isOfxFamily && statements.length > 0)) {
        notify(
          file.name,
          t('{{name}} could not be read: {{message}}', {
            name: file.name,
            message: result.errors[0].message,
          }),
        );
        continue;
      }

      if (isOfxFamily) {
        isFilled = addStatements(
          file.name,
          fileFormat,
          hash,
          statements,
          isFilled,
        );
      } else if (fileFormat === 'xml') {
        const rows = camtRows(hash, result.transactions ?? []);
        onAction({
          type: 'add-file',
          draftId: id,
          file: {
            id: hash,
            name: file.name,
            format: fileFormat,
            rows,
            statement: null,
            csvBalance: null,
            needsMapping: false,
          },
        });
        announce(
          t('{{name}}: {{transactions}} found.', {
            name: file.name,
            transactions: transactionsText(rows.length, t),
          }),
        );
      } else {
        const raw = toRawRows(result.transactions ?? []);
        onAction({
          type: 'add-file',
          draftId: id,
          file: {
            id: hash,
            name: file.name,
            format: fileFormat,
            rows: [],
            statement: null,
            csvBalance: null,
            needsMapping: true,
          },
          rawCsv: raw,
        });
        announce(
          raw.length === 1
            ? t('{{name}}: {{count}} row found. Needs columns.', {
                name: file.name,
                count: raw.length,
              })
            : t('{{name}}: {{count}} rows found. Needs columns.', {
                name: file.name,
                count: raw.length,
              }),
        );
      }
    }
  }

  function addStatements(
    name: string,
    fileFormat: 'ofx' | 'qfx' | 'qbo',
    hash: string,
    statements: ParsedStatement[],
    isFilled: boolean,
  ): boolean {
    const usable = statements.filter(
      statement => statement.kind !== 'investment',
    );
    const investment = statements.length - usable.length;
    if (investment > 0) {
      notify(
        name,
        t(
          '{{name}} has an investment statement. Investment accounts are not supported, so it was left out.',
          { name },
        ),
      );
    }
    if (usable.length === 0) {
      if (investment === 0) {
        notify(name, t('{{name}} has no statements to import.', { name }));
      }
      return isFilled;
    }

    let filled = isFilled;
    for (const [position, statement] of usable.entries()) {
      const fileId = usable.length === 1 ? hash : `${hash}#${position}`;
      const setupFile = statementFile(fileId, name, fileFormat, statement);
      const errors = statement.errors.map(error => error.message);
      const suggestion = suggestAccount(statement, t);

      if (position === 0) {
        onAction({ type: 'add-file', draftId: id, file: setupFile, errors });
        if (!filled) {
          onAction({
            type: 'edit-account',
            draftId: id,
            patch: {
              bank: account.bank.trim() !== '' ? account.bank : suggestion.bank,
              name: account.name.trim() !== '' ? account.name : suggestion.name,
              type: suggestion.type,
            },
          });
          filled = true;
        }
      } else {
        const draftId = uuidv4();
        onAction({ type: 'add-account', draftId });
        onAction({ type: 'add-file', draftId, file: setupFile, errors });
        onAction({ type: 'edit-account', draftId, patch: suggestion });
      }
    }

    announce(
      usable.length === 1
        ? statementSummary(name, usable[0], t, locale)
        : t('{{name}} holds {{count}} accounts. Each has its own card.', {
            name,
            count: usable.length,
          }),
    );
    return filled;
  }

  async function dropFiles(event: DropEvent) {
    const files = await Promise.all(
      event.items.filter(isFileDropItem).map(item => item.getFile()),
    );
    await addFiles(files);
  }

  return (
    <View
      role="group"
      aria-labelledby={headingId}
      data-testid="setup-account-card"
      style={cardStyle}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h2 id={headingId} tabIndex={-1} style={cardHeadingStyle}>
          {displayName}
        </h2>
        <Button
          variant="bare"
          onPress={() => onAction({ type: 'remove-account', draftId: id })}
        >
          <Trans>Remove</Trans>
          <Text style={styles.visuallyHidden}> {displayName}</Text>
        </Button>
      </View>

      <View
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.4fr 1fr',
          gap: 10,
        }}
      >
        <Field label={t('Bank')} htmlFor={`setup-bank-${id}`}>
          <Input
            id={`setup-bank-${id}`}
            value={account.bank}
            onChangeValue={bank =>
              onAction({ type: 'edit-account', draftId: id, patch: { bank } })
            }
          />
        </Field>
        <Field label={t('Account name')} htmlFor={`setup-name-${id}`}>
          <Input
            id={`setup-name-${id}`}
            value={account.name}
            onChangeValue={name =>
              onAction({ type: 'edit-account', draftId: id, patch: { name } })
            }
          />
        </Field>
        <Field label={t('Type')} htmlFor={`setup-type-${id}`}>
          <Select
            id={`setup-type-${id}`}
            value={account.type}
            options={typeOptions}
            onChange={type =>
              onAction({ type: 'edit-account', draftId: id, patch: { type } })
            }
          />
        </Field>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Checkbox
          id={`setup-onbudget-${id}`}
          checked={!account.offbudget}
          onChange={event =>
            onAction({
              type: 'edit-account',
              draftId: id,
              patch: { offbudget: !event.currentTarget.checked },
            })
          }
        />
        <label htmlFor={`setup-onbudget-${id}`}>
          <Trans>On budget</Trans>
        </label>
      </View>

      {account.files.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            No files. This account is created with the balance you enter and no
            history.
          </Trans>
        </Text>
      ) : null}

      {account.files.map(file => {
        const errors = fileErrors[file.id] ?? [];
        return (
          <View
            key={file.id}
            style={errors.length > 0 ? { ...goldStyle, gap: 4 } : chipStyle}
          >
            {errors.length > 0 ? (
              <GoldFlag label={t('Fix or remove this file')} />
            ) : null}
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Text style={badgeStyle}>{file.format.toUpperCase()}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text>{file.name}</Text>
                <Text style={smallSubdued}>
                  {fileNote(file, review, rawCsv, t, locale)}
                </Text>
              </View>
              <Button
                id={`setup-remove-file-${file.id}`}
                variant="bare"
                aria-label={t('Remove {{name}}', { name: file.name })}
                onPress={() => {
                  onAction({
                    type: 'remove-file',
                    draftId: id,
                    fileId: file.id,
                  });
                  announce(t('{{name}} removed.', { name: file.name }));
                }}
              >
                <SvgClose style={{ width: 8, height: 8 }} />
              </Button>
            </View>
            {errors.length > 0 ? (
              <Text>
                {errors.length === 1
                  ? t('{{count}} row could not be read: {{message}}', {
                      count: 1,
                      message: errors[0],
                    })
                  : t(
                      '{{count}} rows could not be read. The first: {{message}}',
                      { count: errors.length, message: errors[0] },
                    )}
              </Text>
            ) : null}
          </View>
        );
      })}

      {notices.map(notice => (
        <View key={notice.id} style={chipStyle}>
          <Text style={{ flex: 1 }}>{notice.message}</Text>
          <Button
            variant="bare"
            aria-label={t('Remove the message about {{name}}', {
              name: notice.name,
            })}
            onPress={() =>
              setNotices(current =>
                current.filter(item => item.id !== notice.id),
              )
            }
          >
            <SvgClose style={{ width: 8, height: 8 }} />
          </Button>
        </View>
      ))}

      <DropZone
        aria-label={t('Drop files for {{name}}', { name: displayName })}
        onDrop={event => void dropFiles(event)}
        className={({ isDropTarget }) =>
          css({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: 10,
            borderRadius: 4,
            border: `1px dashed ${isDropTarget ? theme.buttonPrimaryBackground : theme.tableBorder}`,
            color: theme.pageTextSubdued,
          })
        }
      >
        <FileTrigger
          allowsMultiple
          acceptedFileTypes={FILE_FORMATS.map(format => `.${format}`)}
          onSelect={list => {
            if (list) {
              void addFiles(Array.from(list));
            }
          }}
        >
          <Button
            id={`setup-add-files-${id}`}
            variant="bare"
            style={{
              padding: 2,
              color: theme.pageTextLink,
              textDecoration: 'underline',
            }}
          >
            <Trans>Add files</Trans>
            <Text style={styles.visuallyHidden}>
              {' '}
              {t('for {{name}}', { name: displayName })}
            </Text>
          </Button>
        </FileTrigger>
        <Text>
          <Trans>or drop them here</Trans>
        </Text>
      </DropZone>

      {unmapped.length > 0 ? (
        <View style={goldStyle}>
          <GoldFlag label={t('Needs columns')} />
          {unmapped.map((file, position) => (
            <View key={file.id} style={{ gap: 6 }}>
              <Text>
                {t(
                  'Tell Actual which columns in {{name}} hold the date, description and amount.',
                  { name: file.name },
                )}
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <Button
                  id={position === 0 ? `setup-map-${id}` : undefined}
                  onPress={() => onMapColumns(file)}
                >
                  <Trans>Map columns</Trans>
                  <Text style={styles.visuallyHidden}>
                    {' '}
                    {t('for {{name}}', { name: file.name })}
                  </Text>
                </Button>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {balanceBlock !== null || enteredKnown !== null ? (
        <BalanceQuestion
          inputId={`setup-balance-${id}`}
          question={balanceQuestion(account, questionDate, t, locale)}
          help={
            account.files.length === 0
              ? t('The account starts with this balance.')
              : t(
                  "Use the balance on your statement or in your bank's app for that day. Pending transactions are not in your downloaded file.",
                )
          }
          ledgerNote={
            balanceBlock?.kind === 'ledger-after-end'
              ? t(
                  "This file's balance is dated {{ledgerDate}}, after its last transaction on {{end}}. Activity in between is missing, so enter the balance on {{end}}.",
                  {
                    ledgerDate: longDate(balanceBlock.ledgerDate, locale),
                    end: longDate(balanceBlock.end, locale),
                  },
                )
              : null
          }
          needsBalance={balanceBlock !== null}
          isCredit={account.type === 'credit'}
          entered={account.entered}
          onCommit={entered =>
            onAction({ type: 'edit-account', draftId: id, patch: { entered } })
          }
        />
      ) : null}
    </View>
  );
}

type BalanceQuestionProps = {
  inputId: string;
  question: string;
  help: string;
  ledgerNote: string | null;
  needsBalance: boolean;
  isCredit: boolean;
  entered: number | null;
  onCommit: (entered: number | null) => void;
};

function BalanceQuestion({
  inputId,
  question,
  help,
  ledgerNote,
  needsBalance,
  isCredit,
  entered,
  onCommit,
}: BalanceQuestionProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const [text, setText] = useState(
    entered === null ? '' : format.forEdit(entered),
  );

  function commit(value: string) {
    const next = value.trim() === '' ? null : format.fromEdit(value, null);
    if (next !== entered) {
      onCommit(next);
    }
  }

  // Same children in the same slots in both states, so the input is never
  // remounted and keeps focus while the review updates
  return (
    <View style={needsBalance ? goldStyle : { gap: 6 }}>
      {needsBalance ? <GoldFlag label={t('Needs a balance')} /> : null}
      {ledgerNote !== null ? <Text>{ledgerNote}</Text> : null}
      <label
        htmlFor={inputId}
        style={
          needsBalance
            ? { fontWeight: 500 }
            : { fontSize: 12, color: theme.pageTextSubdued }
        }
      >
        {question}
      </label>
      {needsBalance ? (
        <Text style={{ color: theme.pageTextSubdued }}>{help}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Input
          id={inputId}
          inputMode="decimal"
          value={text}
          onChangeValue={setText}
          onEnter={commit}
          onUpdate={commit}
          style={{ width: 140, textAlign: 'right' }}
        />
        {isCredit ? (
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>owed</Trans>
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function GoldFlag({ label }: { label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        fontWeight: 600,
      }}
    >
      <SvgAlertTriangle
        aria-hidden="true"
        style={{
          width: 13,
          height: 13,
          color: theme.warningText,
          flexShrink: 0,
        }}
      />
      <Text>{label}</Text>
    </View>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 4 }}>
      <label htmlFor={htmlFor} style={smallSubdued}>
        {label}
      </label>
      {children}
    </View>
  );
}

const FILE_FORMATS = [
  'ofx',
  'qfx',
  'qbo',
  'qif',
  'csv',
  'tsv',
  'xml',
] as const satisfies ReadonlyArray<SetupFile['format']>;

type ParsedTransactions = NonNullable<ParseFileResult['transactions']>;

function formatOf(name: string): SetupFile['format'] | null {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return FILE_FORMATS.find(format => format === extension) ?? null;
}

function parseOptions(
  format: SetupFile['format'],
  fileName: string,
): ParseFileOptions {
  switch (format) {
    case 'csv':
    case 'tsv':
      return {
        hasHeaderRow: true,
        delimiter: defaultImportSettings(fileName).delimiter,
      };
    case 'qif':
    case 'xml':
      return { importNotes: true };
    case 'ofx':
    case 'qfx':
    case 'qbo':
      return { importNotes: true, fallbackMissingPayeeToMemo: true };
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function statementFile(
  fileId: string,
  name: string,
  format: 'ofx' | 'qfx' | 'qbo',
  statement: ParsedStatement,
): SetupFile {
  return {
    id: fileId,
    name,
    format,
    rows: statement.transactions.map((trans, index) => ({
      id: `${fileId}:${index}`,
      fileId,
      date: trans.date,
      amount: amountToInteger(trans.amount),
      payeeName: trans.payee_name ?? '',
      importedPayee: trans.imported_payee ?? '',
      notes: trans.notes || null,
      importedId:
        'imported_id' in trans && typeof trans.imported_id === 'string'
          ? trans.imported_id
          : null,
    })),
    statement: {
      org: statement.org,
      accountId: statement.accountId,
      accountType: statement.accountType,
      start: statement.start,
      end: statement.end,
      ledgerBalance:
        statement.ledgerBalance === null
          ? null
          : amountToInteger(statement.ledgerBalance),
      ledgerDate: statement.ledgerDate,
    },
    csvBalance: null,
    needsMapping: false,
  };
}

function camtRows(
  fileId: string,
  transactions: ParsedTransactions,
): SetupRow[] {
  return transactions.flatMap((trans, index): SetupRow[] => {
    if (Array.isArray(trans)) {
      return [];
    }
    const amount = Number(trans.amount);
    const date = String(trans.date ?? '');
    if (!Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return [];
    }
    const payeeName = String(trans.payee_name ?? '');
    return [
      {
        id: `${fileId}:${index}`,
        fileId,
        date,
        amount: amountToInteger(amount),
        payeeName,
        importedPayee: String(trans.imported_payee ?? payeeName),
        notes: trans.notes ? String(trans.notes) : null,
        importedId:
          'imported_id' in trans && typeof trans.imported_id === 'string'
            ? trans.imported_id
            : null,
      },
    ];
  });
}

function toRawRows(transactions: ParsedTransactions): RawCsvRows {
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

function accountTypeOf(statement: ParsedStatement): SetupAccountType {
  if (statement.kind === 'credit') {
    return 'credit';
  }
  switch ((statement.accountType ?? '').toUpperCase()) {
    case 'CHECKING':
      return 'checking';
    case 'SAVINGS':
    case 'MONEYMRKT':
      return 'savings';
    case 'CREDITLINE':
      return 'credit';
    default:
      return 'other';
  }
}

function suggestAccount(
  statement: ParsedStatement,
  t: TFunction,
): { bank: string; name: string; type: SetupAccountType } {
  const type = accountTypeOf(statement);
  const bank = statement.org ?? '';
  const kind =
    type === 'credit'
      ? t('Card')
      : type === 'savings'
        ? t('Savings')
        : type === 'checking'
          ? t('Checking')
          : '';
  const last4 = statement.accountId ? statement.accountId.slice(-4) : '';
  const base = [bank, kind].filter(part => part !== '').join(' ');
  return {
    bank,
    type,
    name: last4 !== '' ? `${base} ••${last4}`.trim() : base,
  };
}

function statementSummary(
  name: string,
  statement: ParsedStatement,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  const dates = statement.transactions.map(trans => trans.date).sort();
  if (dates.length === 0) {
    return t('{{name}}: no transactions.', { name });
  }
  return t('{{name}}: {{transactions}}, {{from}} to {{to}}.', {
    name,
    transactions: transactionsText(dates.length, t),
    from: shortDate(dates[0], locale),
    to: shortDate(dates[dates.length - 1], locale),
  });
}

function fileNote(
  file: SetupFile,
  review: ReviewAccount | undefined,
  rawCsv: Record<string, RawCsvRows>,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  if (file.needsMapping) {
    const count = rawCsv[file.id]?.length ?? 0;
    return count === 1
      ? t('{{count}} row found · columns not mapped yet', { count })
      : t('{{count}} rows found · columns not mapped yet', { count });
  }
  const parts: string[] = [];
  const dates = file.rows.map(row => row.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  if (dates.length === 0) {
    parts.push(t('No transactions'));
  } else if (from === to) {
    parts.push(
      t('{{transactions}}, {{date}}', {
        transactions: transactionsText(dates.length, t),
        date: shortDate(from, locale),
      }),
    );
  } else {
    parts.push(
      t('{{transactions}}, {{from}} to {{to}}', {
        transactions: transactionsText(dates.length, t),
        from: shortDate(from, locale),
        to: shortDate(to, locale),
      }),
    );
  }
  const skipped =
    review?.skipped.filter(skip => skip.row.fileId === file.id).length ?? 0;
  if (skipped > 0) {
    parts.push(
      skipped === 1
        ? t('{{count}} duplicate skipped', { count: skipped })
        : t('{{count}} duplicates skipped', { count: skipped }),
    );
  }
  return parts.join(' · ');
}

function balanceQuestion(
  account: SetupAccountDraft,
  date: string | null,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  if (account.files.length === 0 || date === null) {
    return t('What is the balance today?');
  }
  const long = longDate(date, locale);
  return account.type === 'credit'
    ? t('How much did you owe on {{date}}?', { date: long })
    : t('What was the balance on {{date}}?', { date: long });
}

const cardStyle = {
  gap: 12,
  padding: 16,
  backgroundColor: theme.tableBackground,
  border: `1px solid ${theme.tableBorder}`,
  borderRadius: 6,
  color: theme.pageText,
} satisfies CSSProperties;

const cardHeadingStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: theme.pageText,
  outline: 'none',
} satisfies CSSProperties;

const chipStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  border: `1px solid ${theme.tableBorder}`,
  borderRadius: 4,
} satisfies CSSProperties;

const badgeStyle = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 6px',
  border: `1px solid ${theme.tableBorder}`,
  borderRadius: 3,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

const smallSubdued = {
  fontSize: 12,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

// Page Ink text with a gold border and icon, never gold text (UX review 5)
const goldStyle = {
  gap: 6,
  padding: '10px 14px',
  borderRadius: 4,
  border: `1px solid ${theme.warningBorder}`,
  borderLeftWidth: 4,
  backgroundColor: theme.warningBackground,
  color: theme.pageText,
} satisfies CSSProperties;
```

`CSSProperties` in this file is React's; `View`'s `style` takes the component library's `CSSProperties`, which accepts these objects. If `tsc` rejects one, import `CSSProperties` from `@actual-app/components/styles` instead, as `forms/index.tsx` does.

- [ ] **Step 12: Implement the page**

`packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx`. The review is recomputed on every render with `buildReview(state.accounts, today)`. Focus that must land on an element the next render creates (a new card, the Change button, the balance input after mapping) goes through `pendingFocus`, which an effect applies after each render. Create checks `creatingRef` before anything else, so a double click or a later press sends nothing while the first request runs (Review Focus 4); the fieldset disables every control on the page meanwhile.

```tsx
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { buildReview } from '@actual-app/core/shared/bank-file-setup';
import type {
  Review,
  SetupAccountDraft,
  SetupFile,
  TransferPair,
} from '@actual-app/core/shared/bank-file-setup';
import * as monthUtils from '@actual-app/core/shared/months';
import type { TFunction } from 'i18next';
import { v4 as uuidv4 } from 'uuid';

import { LiveRegion, useAnnounce } from '#components/LiveRegion';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { AccountCard } from './AccountCard';
import { csvToSetupRows, initialCsvMapping } from './csvRows';
import { formatBalance, ReviewTable } from './ReviewTable';
import { SetupFooter } from './SetupFooter';
import type { SetupBlocker } from './SetupFooter';
import { StartChoice } from './StartChoice';
import { TransferPairs } from './TransferPairs';
import {
  accountDisplayName,
  accountsText,
  fileHash,
  pairKey,
  setupReducer,
  shortDate,
  transactionsText,
  useSetupDraft,
} from './useSetupDraft';
import type { SetupAction, SetupState } from './useSetupDraft';

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  const format = useFormat();
  const locale = useLocale();
  const [state, setup] = useSetupDraft();
  const creatingRef = useRef(false);
  const pendingFocus = useRef<string[]>([]);

  useEffect(() => {
    const targets = pendingFocus.current;
    if (targets.length === 0) {
      return;
    }
    pendingFocus.current = [];
    for (const id of targets) {
      const element = document.getElementById(id);
      if (element) {
        element.focus();
        return;
      }
    }
  });

  const today = monthUtils.currentDay();
  const review = buildReview(state.accounts, today);
  const blockers = getBlockers(state.accounts, review, state.fileErrors, t);
  const unanswered = review.candidatePairs.filter(
    pair => state.answers[pairKey(pair)] === undefined,
  ).length;

  function leave() {
    navigate('/budget');
  }

  function focusById(id: string) {
    document.getElementById(id)?.focus();
  }

  function handleAction(action: SetupAction) {
    setup(action);
    if (action.type === 'remove-account') {
      pendingFocus.current = ['setup-add-account'];
    }
    if (action.type === 'remove-file') {
      pendingFocus.current = [`setup-add-files-${action.draftId}`];
    }
    if (action.type === 'edit-account' && action.patch.entered !== undefined) {
      announceBalance(action);
    }
  }

  // UX review 2: the new starting balance is announced, not only redrawn
  function announceBalance(
    action: Extract<SetupAction, { type: 'edit-account' }>,
  ) {
    const next = setupReducer(state, action);
    const index = next.accounts.findIndex(
      account => account.id === action.draftId,
    );
    if (index < 0) {
      return;
    }
    const account = next.accounts[index];
    const reviewed = buildReview(next.accounts, today).accounts[index];
    const name = accountDisplayName(account, index, t);
    announce(
      reviewed.starting
        ? t('{{name}}: starting balance {{amount}} on {{date}}.', {
            name,
            amount: formatBalance(
              format,
              reviewed.starting.amount,
              account.type,
              t,
            ),
            date: shortDate(reviewed.starting.date, locale),
          })
        : t('{{name}} needs a balance.', { name }),
    );
  }

  function findFileOwner(hash: string): string | null {
    for (const [index, account] of state.accounts.entries()) {
      if (account.files.some(file => fileHash(file.id) === hash)) {
        return accountDisplayName(account, index, t);
      }
    }
    return null;
  }

  function openMapping(draftId: string, file: SetupFile) {
    const rawRows = state.rawCsv[file.id] ?? [];
    dispatch(
      pushModal({
        modal: {
          name: 'bank-file-setup-csv-mapping',
          options: {
            fileName: file.name,
            rawRows,
            initial:
              state.mappings[file.id] ?? initialCsvMapping(file.name, rawRows),
            onDone: mapping => {
              const { rows, balance, errors } = csvToSetupRows(
                file.id,
                rawRows,
                mapping,
              );
              if (rows.length === 0) {
                announce(
                  t(
                    'No transactions could be read from {{name}} with these columns. {{error}}',
                    { name: file.name, error: errors[0] ?? '' },
                  ),
                );
                return;
              }
              setup({
                type: 'map-csv',
                fileId: file.id,
                mapping,
                rows,
                balance,
              });
              pendingFocus.current = [
                `setup-balance-${draftId}`,
                `setup-card-${draftId}`,
              ];
              announce(
                t('Columns mapped for {{name}}: {{transactions}}.', {
                  name: file.name,
                  transactions: transactionsText(rows.length, t),
                }),
              );
            },
          },
        },
      }),
    );
  }

  function answerPair(
    pair: TransferPair,
    answer: 'confirmed' | 'separate' | null,
  ) {
    setup({ type: 'answer-pair', pair, answer });
    const key = pairKey(pair);
    pendingFocus.current =
      answer === null
        ? [`setup-pair-confirm-${key}`]
        : [`setup-pair-change-${key}`];
    announce(
      answer === 'confirmed'
        ? t('Transfer confirmed.')
        : answer === 'separate'
          ? t('Kept as two transactions.')
          : t('Answer cleared.'),
    );
  }

  async function create() {
    // Review Focus 4: nothing is sent while a Create is in flight
    if (creatingRef.current) {
      return;
    }
    if (state.accounts.length === 0) {
      focusById('setup-add-account');
      return;
    }
    if (blockers.length > 0) {
      focusById(blockers[0].targetId);
      return;
    }

    creatingRef.current = true;
    setup({ type: 'create-start' });
    const confirmedPairs = review.candidatePairs.filter(
      pair => state.answers[pairKey(pair)] === 'confirmed',
    );
    const result = await send('setup-create', {
      accounts: state.accounts,
      confirmedPairs,
      today,
    }).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : JSON.stringify(error),
    }));

    // The server's messages are English and technical: log them, and show
    // the page's own translated text
    if (!result.ok) {
      console.error('Bank file setup failed:', result.error);
      creatingRef.current = false;
      setup({ type: 'create-failed', error: result.error });
      announce(t('Nothing was created. Check the accounts and try again.'));
      return;
    }

    const summary = t(
      'Created {{accounts}} and {{transactions}}. They are uncategorized; start with the ones below. Past months will look overspent because nothing was budgeted in them.',
      {
        accounts: accountsText(result.accountIds.length, t),
        transactions: transactionsText(result.transactionCount, t),
      },
    );
    announce(summary);
    dispatch(
      addNotification({ notification: { type: 'message', message: summary } }),
    );
    // Everything is committed; a failure after the commit is only reported
    if (result.warning) {
      console.error('Bank file setup warning:', result.warning);
      dispatch(
        addNotification({
          notification: {
            type: 'warning',
            message: t(
              'Everything was created, but a step after saving did not finish. Your accounts and transactions are safe.',
            ),
          },
        }),
      );
    }
    navigate('/categories/uncategorized');
  }

  if (state.step === 'choice') {
    return (
      <View style={pageStyle}>
        <LiveRegion />
        <StartChoice
          onSetUp={() => {
            setup({ type: 'choose-setup', draftId: uuidv4() });
            pendingFocus.current = ['setup-title'];
          }}
          onStartEmpty={leave}
        />
      </View>
    );
  }

  return (
    <View style={pageStyle} data-testid="bank-file-setup-page">
      <LiveRegion />
      <View style={columnStyle}>
        <fieldset disabled={state.creating} style={fieldsetStyle}>
          <View style={{ gap: 4 }}>
            <h1 id="setup-title" tabIndex={-1} style={titleStyle}>
              <Trans>Your accounts</Trans>
            </h1>
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>
                Add each bank account, then the files you downloaded for it.
                Nothing is created until you click Create.
              </Trans>
            </Text>
          </View>

          {state.accounts.map((account, index) => (
            <AccountCard
              key={account.id}
              account={account}
              index={index}
              review={review.accounts[index]}
              rawCsv={state.rawCsv}
              fileErrors={state.fileErrors}
              findFileOwner={findFileOwner}
              onAction={handleAction}
              onMapColumns={file => openMapping(account.id, file)}
            />
          ))}

          <View style={{ flexDirection: 'row' }}>
            <Button
              id="setup-add-account"
              onPress={() => {
                const draftId = uuidv4();
                setup({ type: 'add-account', draftId });
                pendingFocus.current = [`setup-bank-${draftId}`];
              }}
            >
              <Trans>Add account</Trans>
            </Button>
          </View>

          <View style={{ gap: 8 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}
            >
              <h2 id="setup-review-heading" style={sectionHeadingStyle}>
                <Trans>What will be created</Trans>
              </h2>
              <Text style={{ fontSize: 12, color: theme.pageTextSubdued }}>
                <Trans>Updates as you edit</Trans>
              </Text>
            </View>
            <ReviewTable
              accounts={state.accounts}
              review={review}
              labelledBy="setup-review-heading"
            />
          </View>

          {review.candidatePairs.length > 0 ? (
            <TransferPairs
              pairs={review.candidatePairs}
              answers={state.answers}
              accounts={state.accounts}
              review={review}
              onAnswer={answerPair}
            />
          ) : null}
        </fieldset>

        <SetupFooter
          accountCount={state.accounts.length}
          transactionCount={review.transactionCount}
          blockers={blockers}
          unanswered={unanswered}
          creating={state.creating}
          error={state.error}
          onCreate={() => void create()}
          onFocusBlocker={focusById}
          onLeave={leave}
        />
      </View>
    </View>
  );
}

// One blocker per account, in the order a person fixes them: the name, a
// file with unreadable rows, the columns, then the balance
function getBlockers(
  accounts: SetupAccountDraft[],
  review: Review,
  fileErrors: SetupState['fileErrors'],
  t: TFunction,
): SetupBlocker[] {
  return accounts.flatMap((account, index): SetupBlocker[] => {
    const accountName = accountDisplayName(account, index, t);
    const block = review.accounts[index]?.block ?? null;
    const unreadable = account.files.find(
      file => (fileErrors[file.id] ?? []).length > 0,
    );
    if (account.name.trim() === '') {
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'name',
          targetId: `setup-name-${account.id}`,
        },
      ];
    }
    if (unreadable) {
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'file',
          targetId: `setup-remove-file-${unreadable.id}`,
        },
      ];
    }
    if (block === 'needs-columns') {
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'columns',
          targetId: `setup-map-${account.id}`,
        },
      ];
    }
    if (block !== null) {
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'balance',
          targetId: `setup-balance-${account.id}`,
        },
      ];
    }
    return [];
  });
}

const pageStyle = {
  flex: 1,
  overflowY: 'auto',
  backgroundColor: theme.pageBackground,
} satisfies CSSProperties;

const columnStyle = {
  width: '100%',
  maxWidth: 720,
  margin: '0 auto',
  padding: '32px 16px 64px',
  gap: 16,
} satisfies CSSProperties;

const fieldsetStyle = {
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
} satisfies CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: 24,
  fontWeight: 600,
  color: theme.pageText,
  outline: 'none',
} satisfies CSSProperties;

const sectionHeadingStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: theme.pageText,
} satisfies CSSProperties;
```

- [ ] **Step 13: Run the page tests to verify they pass**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/SetupPage.test.tsx src/components/bank-file-setup/useSetupDraft.test.ts`
Expected: PASS, 13 page tests and 15 reducer tests.

If the balance test fails on focus, the balance question is being remounted: check that `BalanceQuestion` renders from the same branch before and after the balance is entered (`balanceBlock !== null || enteredKnown !== null`) and that no child before the `Input` switches between an element and nothing in a different position.

- [ ] **Step 14: Typecheck, lint and commit**

Run: `yarn typecheck`
Expected: no errors. The new files are strict; do not add `// @ts-strict-ignore`.

Run: `yarn lint:fix`
Expected: no remaining errors in the new files. `lint:fix` may rewrite a plain `t()` inside JSX to `<Trans>` (`actual/prefer-trans-over-t`); accept those rewrites.

Run: `yarn generate:i18n` only if the repo's CI checks the generated English file; otherwise skip.

```bash
git add packages/desktop-client/src/components/bank-file-setup/useSetupDraft.ts \
  packages/desktop-client/src/components/bank-file-setup/useSetupDraft.test.ts \
  packages/desktop-client/src/components/bank-file-setup/StartChoice.tsx \
  packages/desktop-client/src/components/bank-file-setup/AccountCard.tsx \
  packages/desktop-client/src/components/bank-file-setup/ReviewTable.tsx \
  packages/desktop-client/src/components/bank-file-setup/TransferPairs.tsx \
  packages/desktop-client/src/components/bank-file-setup/SetupFooter.tsx \
  packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx \
  packages/desktop-client/src/components/bank-file-setup/SetupPage.test.tsx
git commit -m "[AI] Add the bank file setup page with its live review"
```

---

### Task 11: Route and entry points

Covers D1 and D8, and PRD Requirements 1, 2 and 14. The setup page gets its route. Starting a budget on a wide screen opens it. An empty budget and Add account offer it. The tour offer waits until the person leaves setup.

**Files:**

- Modify: `packages/desktop-client/src/components/FinancesApp.tsx:383` (insert the `/setup` route after the `/gocardless/link` route)
- Modify: `packages/desktop-client/src/components/responsive/wide.ts:6` (export `SetupPage`)
- Modify: `packages/desktop-client/src/budgetfiles/budgetfilesSlice.ts:140-172`
- Modify: `packages/desktop-client/src/components/manager/WelcomeScreen.tsx:122`
- Modify: `packages/desktop-client/src/components/manager/BudgetFileSelection.tsx:581-586`
- Create: `packages/desktop-client/src/components/budget/NoAccountsOffer.tsx`
- Modify: `packages/desktop-client/src/components/budget/index.tsx:37,259`
- Modify: `packages/desktop-client/src/components/modals/CreateAccountModal.tsx:1-18,30,119`
- Modify: `packages/desktop-client/src/components/modals/CreateLocalAccountModal.tsx:7-39,100`
- Modify: `packages/desktop-client/src/components/tour/TourAutoOffer.ts:1-54`
- Test: `packages/desktop-client/src/budgetfiles/budgetfilesSlice.test.ts`
- Test: `packages/desktop-client/src/components/budget/NoAccountsOffer.test.tsx`
- Test: `packages/desktop-client/src/components/modals/CreateAccountModal.test.tsx`
- Test: `packages/desktop-client/src/components/modals/CreateLocalAccountModal.test.tsx`
- Test: `packages/desktop-client/src/components/tour/TourAutoOffer.test.tsx`

**Interfaces:**

- Consumes: `SetupPage` from `packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx` (Task 10), `export function SetupPage(): JSX.Element`.
- Produces: `createBudget({ testMode?, demoMode?, openSetup?: boolean })`, which calls `window.__navigate('/setup')` after `loadPrefs` resolves when `openSetup` is true. Also `export function NoAccountsOffer(): JSX.Element | null`, the `/setup` route, and the wide-component name `'SetupPage'`.

- [ ] **Step 1: Write the failing tests**

`packages/desktop-client/src/budgetfiles/budgetfilesSlice.test.ts`:

```ts
import type { NavigateFunction } from 'react-router';

import { initServer } from '@actual-app/core/platform/client/connection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore } from '#mocks';

import { createBudget } from './budgetfilesSlice';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

describe('createBudget', () => {
  let navigate: ReturnType<typeof vi.fn<NavigateFunction>>;

  beforeEach(() => {
    initServer({
      'create-budget': () => ({}),
      'get-budgets': () => [],
      'get-remote-files': () => [],
      'load-prefs': () => ({ id: 'new-budget', budgetName: 'My Finances' }),
      'load-global-prefs': () => ({}),
      'preferences/get': () => ({}),
    });
    navigate = vi.fn<NavigateFunction>();
    window.__navigate = navigate;
  });

  afterEach(() => {
    delete window.__navigate;
  });

  it('opens setup once the new budget has loaded', async () => {
    const store = createTestAppStore();
    let budgetIdWhenNavigating: string | undefined;
    navigate.mockImplementation(() => {
      budgetIdWhenNavigating = store.getState().prefs.local?.id;
    });

    await store.dispatch(createBudget({ openSetup: true }));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/setup');
    expect(budgetIdWhenNavigating).toBe('new-budget');
    expect(store.getState().app.loadingText).toBeNull();
  });

  it('does not navigate without the option', async () => {
    const store = createTestAppStore();

    await store.dispatch(createBudget({}));

    expect(navigate).not.toHaveBeenCalled();
  });
});
```

`packages/desktop-client/src/components/budget/NoAccountsOffer.test.tsx`:

```tsx
import { MemoryRouter, Route, Routes } from 'react-router';

import { generateAccount } from '@actual-app/core/mocks';
import { initServer } from '@actual-app/core/platform/client/connection';
import type { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountQueries } from '#accounts';
import { createTestQueryClient, TestProviders } from '#mocks';

import { NoAccountsOffer } from './NoAccountsOffer';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

describe('NoAccountsOffer', () => {
  const originalWidth = window.innerWidth;
  let queryClient: QueryClient;

  beforeEach(() => {
    // accounts-get never answers, so an unseeded query stays on its placeholder
    initServer({ 'accounts-get': () => new Promise(() => {}) });
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  function renderOffer() {
    render(
      <TestProviders queryClient={queryClient}>
        <MemoryRouter initialEntries={['/budget']}>
          <Routes>
            <Route path="/budget" element={<NoAccountsOffer />} />
            <Route path="/setup" element={<div>Setup page</div>} />
          </Routes>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  it('offers setup when the budget has no accounts', () => {
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    renderOffer();

    expect(screen.getByText('No accounts yet')).toBeVisible();
    expect(
      screen.getByText(
        'Set up this budget from the files you downloaded from your banks.',
      ),
    ).toBeVisible();
  });

  it('opens setup from its button', async () => {
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    renderOffer();

    await userEvent.click(
      screen.getByRole('button', { name: 'Set up from bank files' }),
    );

    expect(screen.getByText('Setup page')).toBeVisible();
  });

  it('is hidden once the budget has an account', () => {
    queryClient.setQueryData(accountQueries.list().queryKey, [
      generateAccount('Checking'),
    ]);
    renderOffer();

    expect(screen.queryByText('No accounts yet')).not.toBeInTheDocument();
  });

  it('is hidden while accounts are still loading', () => {
    renderOffer();

    expect(screen.queryByText('No accounts yet')).not.toBeInTheDocument();
  });

  it('is hidden on narrow screens', () => {
    window.innerWidth = 400;
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    renderOffer();

    expect(screen.queryByText('No accounts yet')).not.toBeInTheDocument();
  });
});
```

`packages/desktop-client/src/components/modals/CreateAccountModal.test.tsx`:

```tsx
import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';
import { pushModal } from '#modals/modalsSlice';

import { CreateAccountModal } from './CreateAccountModal';

vi.mock('#components/banksync/useBuiltInBankSyncProviders', () => ({
  useBuiltInBankSyncProviders: () => ({
    providers: [],
    syncServerStatus: 'online',
    permissionWarning: null,
  }),
}));

describe('CreateAccountModal', () => {
  const originalWidth = window.innerWidth;
  let store: ReturnType<typeof createTestAppStore>;

  beforeEach(() => {
    resetTestProviders();
    store = createTestAppStore();
    store.dispatch(pushModal({ modal: { name: 'add-account', options: {} } }));
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  function renderModal() {
    render(
      <TestProviders store={store}>
        <MemoryRouter initialEntries={['/budget']}>
          <Routes>
            <Route path="/budget" element={<CreateAccountModal />} />
            <Route path="/setup" element={<div>Setup page</div>} />
          </Routes>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  it('closes and opens setup from "Set up from bank files"', async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'Set up from bank files' }),
    );

    expect(screen.getByText('Setup page')).toBeVisible();
    expect(store.getState().modals.modalStack).toEqual([]);
  });

  it('hides the option on narrow screens', () => {
    window.innerWidth = 400;
    renderModal();

    expect(
      screen.getByRole('button', { name: 'Create a local account' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Set up from bank files' }),
    ).not.toBeInTheDocument();
  });
});
```

`packages/desktop-client/src/components/modals/CreateLocalAccountModal.test.tsx`:

```tsx
import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountQueries } from '#accounts';
import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { pushModal } from '#modals/modalsSlice';

import { CreateLocalAccountModal } from './CreateLocalAccountModal';

let mockServerStatus: 'no-server' | 'online' = 'no-server';

vi.mock('#hooks/useSyncServerStatus', () => ({
  useSyncServerStatus: () => mockServerStatus,
}));

describe('CreateLocalAccountModal', () => {
  const originalWidth = window.innerWidth;
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let store: ReturnType<typeof configureTestAppStore>;

  beforeEach(() => {
    mockServerStatus = 'no-server';
    queryClient = createTestQueryClient();
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    store = configureTestAppStore({ queryClient });
    store.dispatch(pushModal({ modal: { name: 'add-local-account' } }));
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  function renderModal() {
    render(
      <TestProviders store={store} queryClient={queryClient}>
        <MemoryRouter initialEntries={['/budget']}>
          <Routes>
            <Route path="/budget" element={<CreateLocalAccountModal />} />
            <Route path="/setup" element={<div>Setup page</div>} />
          </Routes>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  it('offers setup above the form when there is no sync server', async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'Set up from bank files' }),
    );

    expect(screen.getByText('Setup page')).toBeVisible();
    expect(store.getState().modals.modalStack).toEqual([]);
  });

  it('leaves the offer to the previous screen when a sync server is in use', () => {
    mockServerStatus = 'online';
    renderModal();

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Set up from bank files' }),
    ).not.toBeInTheDocument();
  });

  it('hides the offer on narrow screens', () => {
    window.innerWidth = 400;
    renderModal();

    expect(
      screen.queryByRole('button', { name: 'Set up from bank files' }),
    ).not.toBeInTheDocument();
  });
});
```

`packages/desktop-client/src/components/tour/TourAutoOffer.test.tsx`:

```tsx
import { MemoryRouter } from 'react-router';

import type * as PlatformModule from '@actual-app/core/shared/platform';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNavigate } from '#hooks/useNavigate';
import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';

import { TourAutoOffer } from './TourAutoOffer';
import { TOUR_OFFER_NOTIFICATION_ID, TourProvider } from './TourProvider';

vi.mock('@actual-app/core/shared/platform', async () => {
  const actual = await vi.importActual<typeof PlatformModule>(
    '@actual-app/core/shared/platform',
  );
  return { ...actual, isPlaywright: false };
});

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(to)}>Go to {to}</button>;
}

describe('TourAutoOffer', () => {
  let store: ReturnType<typeof createTestAppStore>;

  beforeEach(() => {
    resetTestProviders();
    store = createTestAppStore();
    window.localStorage.clear();
  });

  function renderAt(path: string) {
    render(
      <TestProviders store={store}>
        <MemoryRouter initialEntries={[path]}>
          <TourProvider>
            <TourAutoOffer />
            <GoTo to="/categories/uncategorized" />
          </TourProvider>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  function tourOffers() {
    return store
      .getState()
      .notifications.notifications.filter(
        notification => notification.id === TOUR_OFFER_NOTIFICATION_ID,
      );
  }

  it('offers the tour on the budget page', () => {
    renderAt('/budget');

    expect(tourOffers()).toHaveLength(1);
  });

  it('waits while setup is open and offers the tour after leaving it', async () => {
    renderAt('/setup');

    expect(tourOffers()).toHaveLength(0);

    await userEvent.click(
      screen.getByRole('button', { name: 'Go to /categories/uncategorized' }),
    );

    expect(tourOffers()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `yarn workspace @actual-app/web run test src/budgetfiles/budgetfilesSlice.test.ts src/components/budget/NoAccountsOffer.test.tsx src/components/modals/CreateAccountModal.test.tsx src/components/modals/CreateLocalAccountModal.test.tsx src/components/tour/TourAutoOffer.test.tsx`

Expected: FAIL. `NoAccountsOffer.test.tsx` cannot resolve `./NoAccountsOffer`. In `budgetfilesSlice.test.ts`, "opens setup once the new budget has loaded" fails with `navigate` called 0 times. Both modal tests fail to find the button "Set up from bank files". The TourAutoOffer "waits while setup is open" test fails with 1 offer where 0 was expected. The tests that check something is absent pass already (the narrow, loading and online cases, "does not navigate without the option", and "offers the tour on the budget page").

- [ ] **Step 3: Implement**

`packages/desktop-client/src/components/responsive/wide.ts`, after the `GoCardlessLink` export (line 6):

```ts
export { SetupPage } from '#components/bank-file-setup/SetupPage';
```

`packages/desktop-client/src/components/FinancesApp.tsx`, insert after the `/gocardless/link` route (after line 383). `WideComponent` is already imported at line 39. Going through it keeps the setup page in the lazily loaded wide chunk, the same way `GoCardlessLink` is loaded:

```tsx
<Route
  path="/setup"
  element={
    <ErrorBoundary
      FallbackComponent={FeatureErrorFallback}
      resetKeys={[location.pathname]}
    >
      <NarrowNotSupported>
        <WideComponent name="SetupPage" />
      </NarrowNotSupported>
    </ErrorBoundary>
  }
/>
```

`packages/desktop-client/src/budgetfiles/budgetfilesSlice.ts`, replacing lines 140-172. The thunk navigates through `window.__navigate`, the router's navigate function that `ExposeNavigate` publishes for code outside React:

```ts
type CreateBudgetPayload = {
  testMode?: boolean;
  demoMode?: boolean;
  /** Open the bank file setup page once the new budget has loaded */
  openSetup?: boolean;
};

export const createBudget = createAppAsyncThunk(
  `${sliceName}/createBudget`,
  async (
    {
      testMode = false,
      demoMode = false,
      openSetup = false,
    }: CreateBudgetPayload,
    { dispatch },
  ) => {
    dispatch(
      setAppState({
        loadingText:
          testMode || demoMode ? t('Making demo...') : t('Creating budget...'),
      }),
    );

    if (demoMode) {
      await send('create-demo-budget');
    } else {
      await send('create-budget', { testMode });
    }

    dispatch(closeModal());

    await dispatch(loadAllFiles());
    await dispatch(loadPrefs());

    if (openSetup) {
      void window.__navigate?.('/setup');
    }

    // Set the loadingText to null after we've loaded the budget prefs
    // so that the existing manager page doesn't flash
    dispatch(setAppState({ loadingText: null }));
  },
);
```

`packages/desktop-client/src/components/manager/WelcomeScreen.tsx:122`:

```tsx
          onPress={() => dispatch(createBudget({ openSetup: !isNarrowWidth }))}
```

`packages/desktop-client/src/components/manager/BudgetFileSelection.tsx:581-586`. A test file is never sent to setup:

```tsx
const onCreate = ({ testMode = false } = {}) => {
  if (!creating) {
    setCreating(true);
    void dispatch(
      createBudget({ testMode, openSetup: !testMode && !isNarrowWidth }),
    );
  }
};
```

`packages/desktop-client/src/components/budget/NoAccountsOffer.tsx`. The account list has `placeholderData: []` (`accounts/queries.ts:19`). The offer therefore waits for `isPlaceholderData` to clear, so it does not flash on a budget that has accounts:

```tsx
import { useId } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useAccounts } from '#hooks/useAccounts';
import { useNavigate } from '#hooks/useNavigate';

export function NoAccountsOffer() {
  const { isNarrowWidth } = useResponsive();
  const navigate = useNavigate();
  const titleId = useId();
  const { data: accounts = [], isPlaceholderData } = useAccounts();

  if (isNarrowWidth || isPlaceholderData || accounts.length > 0) {
    return null;
  }

  return (
    <View
      role="region"
      aria-labelledby={titleId}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        margin: '8px 0',
        padding: '12px 16px',
        color: theme.tableText,
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        flexShrink: 0,
      }}
    >
      <View style={{ gap: 2 }}>
        <Text id={titleId} style={{ fontSize: 15, fontWeight: 600 }}>
          <Trans>No accounts yet</Trans>
        </Text>
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            Set up this budget from the files you downloaded from your banks.
          </Trans>
        </Text>
      </View>
      <Button variant="primary" onPress={() => void navigate('/setup')}>
        <Trans>Set up from bank files</Trans>
      </Button>
    </View>
  );
}
```

`packages/desktop-client/src/components/budget/index.tsx`. This `Budget` is the wide budget page for both envelope and tracking; narrow widths load the mobile page through `NarrowAlternate`. Add the import after line 37:

```ts
import { NoAccountsOffer } from './NoAccountsOffer';
```

and render the offer above the table, replacing line 259:

```tsx
        <NoAccountsOffer />
        <View style={{ flex: 1 }}>{table}</View>
```

`packages/desktop-client/src/components/modals/CreateAccountModal.tsx`. Add the import after line 6:

```ts
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
```

After line 30 (`const navigate = useNavigate();`):

```ts
const { isNarrowWidth } = useResponsive();
```

Insert the option between the local account group (ends line 118) and the bank sync group (starts line 120). It follows the "Set up bank sync" button's close-then-navigate pattern:

```tsx
{
  !isNarrowWidth && (
    <View style={{ gap: 10 }}>
      <Button
        onPress={() => {
          state.close();
          void navigate('/setup');
        }}
        style={{
          padding: '10px 0',
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        <Trans>Set up from bank files</Trans>
      </Button>
      <Paragraph style={{ fontSize: 15, color: theme.pageTextSubdued }}>
        <Trans>
          Add your accounts and the files you downloaded from your banks.
          Nothing is created until you confirm.
        </Trans>
      </Paragraph>
    </View>
  );
}
```

`packages/desktop-client/src/components/modals/CreateLocalAccountModal.tsx`. The link shows only without a sync server. With a server, this form is reached from `CreateAccountModal`'s choice screen, which has just offered setup. Add the import after line 9:

```ts
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
```

After line 38 (`const isUsingServer = ...`):

```ts
const { isNarrowWidth } = useResponsive();
```

Insert as the first child of the `<View>` at line 100, above the existing `!isUsingServer` text:

```tsx
{
  !isUsingServer && !isNarrowWidth && (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        marginBottom: 10,
      }}
    >
      <Text style={{ color: theme.pageTextSubdued }}>
        <Trans>Starting from files you downloaded from your banks?</Trans>
      </Text>
      <Button
        variant="bare"
        style={{
          padding: 0,
          color: theme.pageTextLink,
          textDecoration: 'underline',
        }}
        onPress={() => {
          dispatch(closeModal());
          void navigate('/setup');
        }}
      >
        <Trans>Set up from bank files</Trans>
      </Button>
    </View>
  );
}
```

`packages/desktop-client/src/components/tour/TourAutoOffer.ts`, the whole file. Because `pathname` is in the effect's dependencies, the offer posts when the person leaves `/setup` by Create or by starting empty:

```ts
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';

import { useIsTestEnv } from '#hooks/useIsTestEnv';
import { useLocalPref } from '#hooks/useLocalPref';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { TOUR_OFFER_NOTIFICATION_ID, useTour } from './TourProvider';

export function TourAutoOffer() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { isNarrowWidth } = useResponsive();
  const isTestEnv = useIsTestEnv();
  const { pathname } = useLocation();
  const { startTour } = useTour();
  const [introSeen, setIntroSeen] = useLocalPref('tour.introSeen');
  const hasOffered = useRef(false);
  const isInSetup = pathname === '/setup';

  useEffect(() => {
    if (
      hasOffered.current ||
      introSeen ||
      isNarrowWidth ||
      isTestEnv ||
      isInSetup
    ) {
      return;
    }
    hasOffered.current = true;
    dispatch(
      addNotification({
        notification: {
          id: TOUR_OFFER_NOTIFICATION_ID,
          type: 'message',
          sticky: true,
          title: t('Welcome to {{appName}}!', { appName: 'Actual' }),
          message: t(
            'New to {{appName}}? Take a short tour to learn how budgeting works and find your way around.',
            { appName: 'Actual' },
          ),
          button: {
            title: t('Take the tour'),
            action: () => startTour(),
          },
          onClose: () => setIntroSeen(true),
        },
      }),
    );
  }, [
    dispatch,
    introSeen,
    isInSetup,
    isNarrowWidth,
    isTestEnv,
    setIntroSeen,
    startTour,
    t,
  ]);

  return null;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `yarn workspace @actual-app/web run test src/budgetfiles/budgetfilesSlice.test.ts src/components/budget/NoAccountsOffer.test.tsx src/components/modals/CreateAccountModal.test.tsx src/components/modals/CreateLocalAccountModal.test.tsx src/components/tour/TourAutoOffer.test.tsx`

Expected: PASS, 14 tests in 5 files.

Then run the existing tour tests to check the effect change broke nothing: `yarn workspace @actual-app/web run test src/components/tour`. Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
yarn typecheck
yarn lint:fix
git add packages/desktop-client/src/components/FinancesApp.tsx \
  packages/desktop-client/src/components/responsive/wide.ts \
  packages/desktop-client/src/budgetfiles/budgetfilesSlice.ts \
  packages/desktop-client/src/budgetfiles/budgetfilesSlice.test.ts \
  packages/desktop-client/src/components/manager/WelcomeScreen.tsx \
  packages/desktop-client/src/components/manager/BudgetFileSelection.tsx \
  packages/desktop-client/src/components/budget/NoAccountsOffer.tsx \
  packages/desktop-client/src/components/budget/NoAccountsOffer.test.tsx \
  packages/desktop-client/src/components/budget/index.tsx \
  packages/desktop-client/src/components/modals/CreateAccountModal.tsx \
  packages/desktop-client/src/components/modals/CreateAccountModal.test.tsx \
  packages/desktop-client/src/components/modals/CreateLocalAccountModal.tsx \
  packages/desktop-client/src/components/modals/CreateLocalAccountModal.test.tsx \
  packages/desktop-client/src/components/tour/TourAutoOffer.ts \
  packages/desktop-client/src/components/tour/TourAutoOffer.test.tsx
git commit -m "[AI] Add the setup route and offer it from new budgets, the empty budget and Add account"
```

---

### Task 12: End to end

Covers the PRD's "How we will know it works" for the parts this branch can check. A real QFX and a Chase card CSV go through the whole flow, and the test checks balances, starting balances and the transfer. Closing setup before Create must leave no accounts. The generator-based regression check is not in this plan: the sample data generator is on the unmerged `sample-data-generator` branch.

The fixture numbers are chosen so every expected value can be worked out by hand:

| Account        | Imported net | Known balance                           | Starting balance       | Ending balance |
| -------------- | ------------ | --------------------------------------- | ---------------------- | -------------- |
| Chase Checking | +4,960.48    | ledger 6,210.48 on 2026-08-03 (= DTEND) | 1,250.00 on 2026-07-01 | 6,210.48       |
| Chase Sapphire | +309.35      | entered 412.60 owed on 2026-08-04       | -721.95 on 2026-07-05  | -412.60        |

The on-budget total is 5,797.88. The only transfer candidate is -523.10 on 2026-08-03 in checking and +523.10 on 2026-08-04 on the card; no other amounts match with opposite signs. Setup creates 8 + 6 = 14 transactions.

**Files:**

- Create: `packages/desktop-client/e2e/data/setup-checking.qfx`
- Create: `packages/desktop-client/e2e/data/setup-card.csv`
- Create: `packages/desktop-client/e2e/page-models/setup-page.ts`
- Modify: `packages/desktop-client/e2e/page-models/configuration-page.ts:1-4,50-56`
- Create: `packages/desktop-client/e2e/bank-file-setup.test.ts`
- Create (generated in Docker): `packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/Bank-file-setup-sets-up-a-budget-from-a-QFX-and-a-CSV-file-{1,2,3,4,5,6}-chromium-linux.png`

**Interfaces:**

- Consumes: the `/setup` route, `createBudget({ openSetup })` from Welcome's "Start budgeting", and `NoAccountsOffer` (Task 11); the setup page markup listed under "Dependencies on Task 10's markup" (Task 10); the `bank-file-setup-csv-mapping` modal composing `FieldMappings` and `DateFormatSelect` (Task 9).
- Produces: `SetupPage` page model (`e2e/page-models/setup-page.ts`); `ConfigurationPage.startFresh()` passing through the choice; `ConfigurationPage.startWithBankFiles(): Promise<SetupPage>`.

- [ ] **Step 1: Show that the onboarding tests fail against the new first run**

With Tasks 10 and 11 in place, "Start budgeting" now opens the choice, so `startFresh()` waits for a budget table that never appears.

Run: `yarn workspace @actual-app/web run playwright test onboarding.test.ts --browser=chromium -g "creates a new empty budget file"`

Expected: FAIL, a timeout in `startFresh` waiting for `getByTestId('budget-table')`.

- [ ] **Step 2: Write the fixtures**

`packages/desktop-client/e2e/data/setup-checking.qfx` (SGML OFX 1.02, the same layout as `loot-core/src/mocks/files/data.qfx`):

```
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
<MESSAGE>SUCCESS
</STATUS>
<DTSERVER>20260805120000.000[-4:EDT]
<LANGUAGE>ENG
<FI>
<ORG>JPMorgan Chase
<FID>10898
</FI>
<INTU.BID>10898
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
<MESSAGE>SUCCESS
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>322271627
<ACCTID>000000004821
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260701120000.000[-4:EDT]
<DTEND>20260803120000.000[-4:EDT]
<STMTTRN>
<TRNTYPE>DIRECTDEP
<DTPOSTED>20260701120000.000[-4:EDT]
<TRNAMT>2400.00
<FITID>202607010001
<NAME>ACME CORP PAYROLL
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260703120000.000[-4:EDT]
<TRNAMT>-1450.00
<FITID>202607030001
<NAME>OAKWOOD APARTMENTS
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260708120000.000[-4:EDT]
<TRNAMT>-86.42
<FITID>202607080001
<NAME>CITY WATER UTILITY
</STMTTRN>
<STMTTRN>
<TRNTYPE>DIRECTDEP
<DTPOSTED>20260715120000.000[-4:EDT]
<TRNAMT>2400.00
<FITID>202607150001
<NAME>ACME CORP PAYROLL
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260720120000.000[-4:EDT]
<TRNAMT>-120.00
<FITID>202607200001
<NAME>VERIZON WIRELESS
</STMTTRN>
<STMTTRN>
<TRNTYPE>ATM
<DTPOSTED>20260725120000.000[-4:EDT]
<TRNAMT>-60.00
<FITID>202607250001
<NAME>ATM WITHDRAWAL
</STMTTRN>
<STMTTRN>
<TRNTYPE>DIRECTDEP
<DTPOSTED>20260801120000.000[-4:EDT]
<TRNAMT>2400.00
<FITID>202608010001
<NAME>ACME CORP PAYROLL
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260803120000.000[-4:EDT]
<TRNAMT>-523.10
<FITID>202608030001
<NAME>Payment to Chase card
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>6210.48
<DTASOF>20260803120000.000[-4:EDT]
</LEDGERBAL>
<AVAILBAL>
<BALAMT>6210.48
<DTASOF>20260803120000.000[-4:EDT]
</AVAILBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
```

`packages/desktop-client/e2e/data/setup-card.csv` (Chase card export columns, newest first; purchases negative and payments positive, as Chase writes them):

```
Transaction Date,Post Date,Description,Category,Type,Amount,Memo
08/04/2026,08/04/2026,Payment Thank You,,Payment,523.10,
08/02/2026,08/03/2026,STARBUCKS STORE 1234,Food & Drink,Sale,-6.75,
07/26/2026,07/27/2026,TRADER JOE'S #552,Groceries,Sale,-62.18,
07/19/2026,07/20/2026,NETFLIX.COM,Entertainment,Sale,-15.49,
07/12/2026,07/13/2026,SHELL OIL 57444,Gas,Sale,-45.10,
07/05/2026,07/06/2026,WHOLE FOODS MARKET,Groceries,Sale,-84.23,
```

- [ ] **Step 3: Write the page models**

`packages/desktop-client/e2e/page-models/setup-page.ts`:

```ts
import path from 'path';

import type { Locator, Page } from '@playwright/test';

type CsvMapping = {
  date: string;
  payee: string;
  amount: string;
  dateFormat: string;
};

export class SetupPage {
  readonly page: Page;
  readonly choiceHeading: Locator;
  readonly root: Locator;
  readonly heading: Locator;
  readonly accountCards: Locator;
  readonly reviewTable: Locator;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.choiceHeading = page.getByRole('heading', {
      name: 'How do you want to start?',
    });
    this.root = page.getByTestId('bank-file-setup-page');
    this.heading = this.root.getByRole('heading', { name: 'Your accounts' });
    this.accountCards = this.root.getByTestId('setup-account-card');
    this.reviewTable = this.root.getByRole('table', {
      name: 'What will be created',
    });
    this.createButton = this.root.getByRole('button', {
      name: 'Create',
      exact: true,
    });
  }

  async chooseSetUpFromBankFiles() {
    await this.page
      .getByRole('button', { name: /^Set up from bank files/ })
      .click();
    await this.heading.waitFor();
  }

  /**
   * Returns the card at `index`, adding cards until it exists. The accounts
   * step may open with one empty card or none; this works with either.
   */
  async accountCard(index: number) {
    while ((await this.accountCards.count()) <= index) {
      await this.root
        .getByRole('button', { name: 'Add account', exact: true })
        .click();
    }
    const card = this.accountCards.nth(index);
    await card.waitFor();
    return card;
  }

  async addFiles(card: Locator, ...fileNames: string[]) {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await card.getByRole('button', { name: /^Add files/ }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(
      fileNames.map(name => path.join(__dirname, '..', 'data', name)),
    );
  }

  async fillAccount(
    card: Locator,
    fields: { bank?: string; name?: string; type?: string },
  ) {
    if (fields.bank != null) {
      const bank = card.getByLabel('Bank', { exact: true });
      await bank.fill(fields.bank);
      await bank.press('Tab');
    }
    if (fields.name != null) {
      const name = card.getByLabel('Account name', { exact: true });
      await name.fill(fields.name);
      await name.press('Tab');
    }
    if (fields.type != null) {
      await card.getByLabel('Type', { exact: true }).click();
      await this.page
        .getByRole('menu')
        .getByRole('button', { name: fields.type, exact: true })
        .click();
    }
  }

  async mapCsvColumns(card: Locator, mapping: CsvMapping) {
    await card.getByRole('button', { name: /^Map columns/ }).click();
    const modal = this.page.getByTestId('bank-file-setup-csv-mapping-modal');
    await modal.waitFor();

    await this.chooseMappingOption(modal, 'Date', mapping.date);
    await this.chooseMappingOption(modal, 'Payee', mapping.payee);
    await this.chooseMappingOption(modal, 'Amount', mapping.amount);
    await this.chooseMappingOption(modal, 'Date format', mapping.dateFormat);

    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    await modal.waitFor({ state: 'detached' });
  }

  async enterBalance(card: Locator, question: RegExp, amount: string) {
    const input = card.getByLabel(question);
    await input.fill(amount);
    await input.press('Tab');
  }

  async confirmOnlyTransfer() {
    await this.root.getByRole('button', { name: /^Confirm/ }).click();
  }

  async create() {
    await this.createButton.click();
    await this.page.waitForURL('**/categories/uncategorized');
  }

  async close() {
    await this.root.getByRole('button', { name: 'Close setup' }).click();
    await this.page
      .getByRole('button', { name: 'Leave setup', exact: true })
      .click();
    await this.page.waitForURL('**/budget');
  }

  /**
   * FieldMappings and DateFormatSelect render a text label directly above
   * a Select button and give the button no accessible name, so the button
   * is found through the label's parent. `.last()` skips a preview table
   * header with the same text, which renders above the mapping fields.
   */
  private async chooseMappingOption(
    modal: Locator,
    label: string,
    option: string,
  ) {
    await modal
      .getByText(label, { exact: true })
      .last()
      .locator('xpath=..')
      .getByRole('button')
      .first()
      .click();
    await this.page
      .getByRole('menu')
      .getByRole('button', { name: option, exact: true })
      .click();
  }
}
```

`packages/desktop-client/e2e/page-models/configuration-page.ts`. Add the import after line 4:

```ts
import { SetupPage } from './setup-page';
```

and replace `startFresh()` (lines 50-56) with:

```ts
  async startFresh() {
    await this.page.getByRole('button', { name: 'Start budgeting' }).click();
    await this.page
      .getByRole('button', { name: /^Start with an empty budget/ })
      .click();

    const budgetPage = new BudgetPage(this.page);
    await budgetPage.waitFor();
    return budgetPage;
  }

  async startWithBankFiles() {
    await this.page.getByRole('button', { name: 'Start budgeting' }).click();

    const setupPage = new SetupPage(this.page);
    await setupPage.chooseSetUpFromBankFiles();
    return setupPage;
  }
```

`startFresh()` has two callers, `onboarding.test.ts:109,120` and `reports.test.ts:247`. All of them run at desktop width, where the choice appears.

- [ ] **Step 4: Run the onboarding and reports tests to verify `startFresh` passes**

Run: `yarn workspace @actual-app/web run playwright test onboarding.test.ts reports.test.ts --browser=chromium -g "empty budget"`

Expected: PASS, 3 tests: "creates a new empty budget file", "navigates back to start page by clicking on \"no server\" in an empty budget file", and "creates a custom report in an empty budget".

- [ ] **Step 5: Write the end-to-end test**

`packages/desktop-client/e2e/bank-file-setup.test.ts`:

```ts
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';
import { SetupPage } from './page-models/setup-page';

test.describe('Bank file setup', () => {
  let page: Page;
  let navigation: Navigation;
  let configurationPage: ConfigurationPage;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new Navigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.goto('/');
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test('sets up a budget from a QFX and a CSV file', async () => {
    await page.getByRole('button', { name: 'Start budgeting' }).click();
    const setupPage = new SetupPage(page);
    await expect(setupPage.choiceHeading).toBeVisible();
    await expect(page).toMatchThemeScreenshots();

    await setupPage.chooseSetUpFromBankFiles();

    // The QFX names its bank and carries a ledger balance dated on its end
    const checking = await setupPage.accountCard(0);
    await setupPage.addFiles(checking, 'setup-checking.qfx');
    await expect(checking.getByLabel('Bank', { exact: true })).toHaveValue(
      'JPMorgan Chase',
    );
    await setupPage.fillAccount(checking, { name: 'Chase Checking' });

    // The CSV needs its columns mapped, then the amount owed
    const card = await setupPage.accountCard(1);
    await setupPage.fillAccount(card, {
      bank: 'Chase',
      name: 'Chase Sapphire',
      type: 'Credit card',
    });
    await setupPage.addFiles(card, 'setup-card.csv');
    await expect(card).toContainText('Needs columns');
    await expect(setupPage.createButton).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await setupPage.mapCsvColumns(card, {
      date: 'Transaction Date',
      payee: 'Description',
      amount: 'Amount',
      dateFormat: 'MM/DD/YYYY',
    });
    await expect(card).toContainText('Needs a balance');
    await setupPage.enterBalance(card, /^How much did you owe on/, '412.60');

    // Starting balances are known balance minus the imported net
    await expect(setupPage.reviewTable).toContainText('1,250.00');
    await expect(setupPage.reviewTable).toContainText('6,210.48');
    await expect(setupPage.reviewTable).toContainText('721.95 owed');
    await expect(setupPage.reviewTable).toContainText('412.60 owed');

    await setupPage.confirmOnlyTransfer();
    await expect(setupPage.root).toContainText(
      '2 accounts and 14 transactions will be created.',
    );
    await expect(page).toMatchThemeScreenshots();

    await setupPage.create();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Created 2 accounts and 14 transactions.' }),
    ).toBeVisible();

    await expect(
      page.getByRole('link', { name: /^Chase Checking/ }),
    ).toContainText('6,210.48');
    await expect(
      page.getByRole('link', { name: /^Chase Sapphire/ }),
    ).toContainText('-412.60');
    await expect(page.getByTestId('sidebar-all-accounts-balance')).toHaveText(
      '5,797.88',
    );

    const checkingPage = await navigation.goToAccountPage('Chase Checking');
    await expect(checkingPage.accountBalance).toHaveText('6,210.48');
    await expect(checkingPage.transactionTableRow).toHaveCount(9);
    const checkingStart = checkingPage.transactionTableRow.filter({
      hasText: 'Starting Balance',
    });
    await expect(checkingStart.getByTestId('credit')).toHaveText('1,250.00');
    const paymentOut = checkingPage.transactionTableRow.filter({
      hasText: 'Chase Sapphire',
    });
    await expect(paymentOut).toHaveCount(1);
    await expect(paymentOut.getByTestId('debit')).toHaveText('523.10');
    await expect(paymentOut.getByTestId('transfer-icon')).toBeVisible();

    const cardPage = await navigation.goToAccountPage('Chase Sapphire');
    await expect(cardPage.accountBalance).toHaveText('-412.60');
    await expect(cardPage.transactionTableRow).toHaveCount(7);
    const cardStart = cardPage.transactionTableRow.filter({
      hasText: 'Starting Balance',
    });
    await expect(cardStart.getByTestId('debit')).toHaveText('721.95');
    const paymentIn = cardPage.transactionTableRow.filter({
      hasText: 'Chase Checking',
    });
    await expect(paymentIn).toHaveCount(1);
    await expect(paymentIn.getByTestId('credit')).toHaveText('523.10');
    await expect(paymentIn.getByTestId('transfer-icon')).toBeVisible();
  });

  test('closing setup before Create leaves no accounts', async () => {
    const setupPage = await configurationPage.startWithBankFiles();

    const checking = await setupPage.accountCard(0);
    await setupPage.addFiles(checking, 'setup-checking.qfx');
    await expect(setupPage.reviewTable).toContainText('6,210.48');

    await setupPage.close();

    await expect(page.getByText('No accounts yet')).toBeVisible();
    await expect(page.getByTestId('sidebar-all-accounts-balance')).toHaveText(
      '0.00',
    );
    await expect(page.getByTestId('sidebar-on-budget-balance')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-off-budget-balance')).toHaveCount(0);
  });
});
```

The sidebar shows "On budget" and "Off budget" only when accounts of that kind exist (`sidebar/Accounts.tsx:102,133`). Their absence therefore shows that no account was created, whatever name setup suggested for the card.

- [ ] **Step 6: Run the flow on the host**

Without `VRT=true`, `toMatchThemeScreenshots` passes without taking a screenshot (`e2e/fixtures.ts:54-62`), so this run checks only the interactions and assertions.

Run: `yarn workspace @actual-app/web run playwright test bank-file-setup.test.ts --browser=chromium`

Expected: PASS, 2 tests.

- [ ] **Step 7: Generate the new snapshots in Docker and confirm onboarding is unchanged**

Follow the running-vrts skill. Snapshots are generated only inside the Playwright Linux image, and every `--update-snapshots` run is scoped to the new test.

1. On the host, start the HTTPS dev server in the background. This runs the app; it does not write snapshots. Wait until `https://localhost:3001` returns 200:

   ```sh
   HTTPS=true yarn start
   ```

2. On macOS, get the LAN address the container will use: `ipconfig getifaddr en0`. Call it `<HOST>`. On Linux, use `localhost`.

3. Generate this test's snapshots inside the container:

   ```sh
   docker run --rm --network host -v "$(pwd)":/work/ -w /work/ \
     mcr.microsoft.com/playwright:v1.61.1-jammy /bin/bash -c \
     "E2E_START_URL=https://<HOST>:3001 yarn vrt --update-snapshots -g 'Bank file setup sets up a budget' bank-file-setup.test.ts"
   ```

   This writes exactly these six files, light, dark and midnight for each of the two assertions:

   ```
   packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/Bank-file-setup-sets-up-a-budget-from-a-QFX-and-a-CSV-file-1-chromium-linux.png
   packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/Bank-file-setup-sets-up-a-budget-from-a-QFX-and-a-CSV-file-2-chromium-linux.png
   packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/Bank-file-setup-sets-up-a-budget-from-a-QFX-and-a-CSV-file-3-chromium-linux.png
   packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/Bank-file-setup-sets-up-a-budget-from-a-QFX-and-a-CSV-file-4-chromium-linux.png
   packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/Bank-file-setup-sets-up-a-budget-from-a-QFX-and-a-CSV-file-5-chromium-linux.png
   packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/Bank-file-setup-sets-up-a-budget-from-a-QFX-and-a-CSV-file-6-chromium-linux.png
   ```

4. Verify: run the same command again without `--update-snapshots`. It must pass.

5. Confirm the onboarding snapshots need no update. Run their VRT in the container without `--update-snapshots`:

   ```sh
   docker run --rm --network host -v "$(pwd)":/work/ -w /work/ \
     mcr.microsoft.com/playwright:v1.61.1-jammy /bin/bash -c \
     "E2E_START_URL=https://<HOST>:3001 yarn vrt -g 'Onboarding' onboarding.test.ts"
   ```

   Expected: PASS. The six existing files come from "checks the page visuals": `Onboarding-checks-the-page-visuals-1-chromium-linux.png` through `-3-` show the Welcome screen, and `-4-` through `-6-` show "Connect to a server". This plan changes neither screen. If this run fails, the change came from something other than this plan: investigate it and do not update the snapshots.

   ```
   packages/desktop-client/e2e/onboarding.test.ts-snapshots/Onboarding-checks-the-page-visuals-1-chromium-linux.png
   packages/desktop-client/e2e/onboarding.test.ts-snapshots/Onboarding-checks-the-page-visuals-2-chromium-linux.png
   packages/desktop-client/e2e/onboarding.test.ts-snapshots/Onboarding-checks-the-page-visuals-3-chromium-linux.png
   packages/desktop-client/e2e/onboarding.test.ts-snapshots/Onboarding-checks-the-page-visuals-4-chromium-linux.png
   packages/desktop-client/e2e/onboarding.test.ts-snapshots/Onboarding-checks-the-page-visuals-5-chromium-linux.png
   packages/desktop-client/e2e/onboarding.test.ts-snapshots/Onboarding-checks-the-page-visuals-6-chromium-linux.png
   ```

6. Read `...-1-chromium-linux.png` and `...-4-chromium-linux.png` to confirm they show the choice and the filled-in setup page.

If Docker is not available, commit the test without the PNGs. CI generates them when someone comments `/update-vrt` on the PR. Say in the handoff that the snapshots are missing.

- [ ] **Step 8: Typecheck, lint and commit**

```bash
yarn typecheck
yarn lint:fix
git add packages/desktop-client/e2e/data/setup-checking.qfx \
  packages/desktop-client/e2e/data/setup-card.csv \
  packages/desktop-client/e2e/page-models/setup-page.ts \
  packages/desktop-client/e2e/page-models/configuration-page.ts \
  packages/desktop-client/e2e/bank-file-setup.test.ts \
  packages/desktop-client/e2e/bank-file-setup.test.ts-snapshots/
git commit -m "[AI] Add an end-to-end test for setting up a budget from bank files"
```

---

### Task 13: Skip the choice when setup is opened from inside a budget

Someone who clicks "Set up from bank files" in Add account or on the empty budget has already chosen. Those entry points pass route state, and the page starts on the accounts step. "Start budgeting" and "Create new file" still show the choice.

**Files:**

- Modify: `packages/desktop-client/src/components/bank-file-setup/useSetupDraft.ts` (`useSetupDraft`)
- Modify: `packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx` (the `useSetupDraft()` call)
- Modify: `packages/desktop-client/src/components/budget/NoAccountsOffer.tsx`, `packages/desktop-client/src/components/modals/CreateAccountModal.tsx`, `packages/desktop-client/src/components/modals/CreateLocalAccountModal.tsx` (their `navigate('/setup')` calls from Task 11)
- Test: `packages/desktop-client/src/components/bank-file-setup/useSetupDraft.test.ts`, `packages/desktop-client/src/components/bank-file-setup/SetupPage.test.tsx`

**Interfaces:**

- Consumes: `setupReducer`, `initialSetupState`, `useSetupDraft` (Task 10); the three entry points (Task 11).
- Produces: `useSetupDraft(options?: { skipChoice?: boolean })`; route state `{ skipChoice: true }` on `/setup`.

- [ ] **Step 1: Write the failing tests**

Append to `useSetupDraft.test.ts`:

```ts
import { renderHook } from '@testing-library/react';

import { useSetupDraft } from './useSetupDraft';

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
```

Append to `SetupPage.test.tsx`, using the file's existing render helper and `MemoryRouter` setup (render at `/setup` with `initialEntries={[{ pathname: '/setup', state: { skipChoice: true } }]}`):

```tsx
it('skips the choice when opened with skipChoice', async () => {
  renderSetupPage({ state: { skipChoice: true } });
  expect(
    screen.queryByRole('heading', { name: 'How do you want to start?' }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { name: 'Your accounts' }),
  ).toBeInTheDocument();
});
```

If Task 10's render helper does not take route state, extend it in this step: add an optional `{ state?: unknown }` argument and pass it into the `MemoryRouter` entry.

- [ ] **Step 2: Run them to verify they fail**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/useSetupDraft.test.ts src/components/bank-file-setup/SetupPage.test.tsx`
Expected: the skipChoice cases FAIL (step is `'choice'`; the choice heading is present).

- [ ] **Step 3: Implement**

In `useSetupDraft.ts`, replace `useSetupDraft` (add `import { v4 as uuidv4 } from 'uuid';` if the file does not import it):

```ts
export function useSetupDraft(options: { skipChoice?: boolean } = {}) {
  return useReducer(setupReducer, initialSetupState, initial =>
    options.skipChoice
      ? setupReducer(initial, { type: 'choose-setup', draftId: uuidv4() })
      : initial,
  );
}
```

The initializer runs once, so the generated id is stable and the reducer stays pure.

In `SetupPage.tsx`, read the route state and pass it through (add `useLocation` to the file's `react-router` import):

```tsx
const location = useLocation();
const skipChoice =
  (location.state as { skipChoice?: unknown } | null)?.skipChoice === true;
const [state, setup] = useSetupDraft({ skipChoice });
```

`location.state` is typed `unknown` by react-router, and the app's `useNavigate` adds `previousLocation` to it, so the check reads only the one field and compares it to `true`.

In the three entry points from Task 11, change each `navigate('/setup')` to:

```ts
void navigate('/setup', { state: { skipChoice: true } });
```

Leave `createBudget`'s `window.__navigate?.('/setup')` unchanged: a new budget shows the choice.

- [ ] **Step 4: Run them to verify they pass**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/ src/components/budget/NoAccountsOffer.test.tsx src/components/modals/`
Expected: PASS, including Task 11's entry-point tests (update any assertion there that expects `navigate` to have been called with only `'/setup'` to expect `('/setup', { state: { skipChoice: true } })`).

- [ ] **Step 5: Typecheck, lint and commit**

```bash
yarn typecheck
yarn lint:fix
git add packages/desktop-client/src/components/bank-file-setup/useSetupDraft.ts \
  packages/desktop-client/src/components/bank-file-setup/useSetupDraft.test.ts \
  packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx \
  packages/desktop-client/src/components/bank-file-setup/SetupPage.test.tsx \
  packages/desktop-client/src/components/budget/NoAccountsOffer.tsx \
  packages/desktop-client/src/components/modals/CreateAccountModal.tsx \
  packages/desktop-client/src/components/modals/CreateLocalAccountModal.tsx
# plus any Task 11 entry-point test file whose assertion Step 4 changed, by name
git commit -m "[AI] Skip the setup choice when opened from inside a budget"
```

---

### Task 14: Save each new account's import settings after Create

D4 promises that a later per-account import of the same bank's files is already set up. After a successful Create, the page saves each mapped file's settings under its new account's id. `setup-create` returns `accountIds` in the same order as the draft's accounts (Task 7), so the page pairs them by index. Saving is best-effort: Create has already succeeded, so a failure here is logged and nothing else changes.

**Files:**

- Modify: `packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx` (the Create handler, after `if (!result.ok) { ... }`)
- Test: `packages/desktop-client/src/components/bank-file-setup/SetupPage.test.tsx`

**Interfaces:**

- Consumes: `importSettingsPrefs(accountId, fileType, settings)` (Task 9); `CsvMapping.settings` built by `buildCsvMapping` (Task 9); `state.mappings` keyed by file id (Task 10); `result.accountIds` in draft order (Task 7).
- Produces: synced prefs `csv-mappings-<accountId>` and the rest of the dialog's key set for every mapped CSV or TSV file.

- [ ] **Step 1: Write the failing test**

Append to `SetupPage.test.tsx`. Use the file's existing helpers from Task 10 for rendering, adding the card CSV, mapping it through the modal's `onDone`, entering the amount owed, and resolving `setup-create` with `{ ok: true, accountIds: ['card'], transactionCount: 2 }`:

```tsx
it('saves the mapped CSV settings under the new account id', async () => {
  const { sendMock } = await renderWithMappedCardCsv({
    createResult: { ok: true, accountIds: ['card'], transactionCount: 2 },
  });

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() => {
    const saved = sendMock.mock.calls
      .filter(([name]) => name === 'preferences/save')
      .map(([, args]) => (args as { id: string }).id);
    expect(saved).toContain('csv-mappings-card');
    expect(saved).toContain('parse-date-card-csv');
  });
});

it('does not save settings when Create fails', async () => {
  const { sendMock } = await renderWithMappedCardCsv({
    createResult: { ok: false, error: 'boom' },
  });

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await screen.findByText(
    'Nothing was created. Check the accounts and try again.',
  );
  expect(
    sendMock.mock.calls.some(([name]) => name === 'preferences/save'),
  ).toBe(false);
});
```

If Task 10's test file has no single helper that reaches this state, add `renderWithMappedCardCsv` in this step by composing its existing helpers: render the page, choose setup, add `Chase0937_Activity.CSV` from the file's fixtures, map it with `initialCsvMapping`, enter `412.60` as the amount owed, and mock `send` so `'setup-parse-file'` returns the fixture's raw rows and `'setup-create'` returns `createResult`. Return the `send` mock.

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/SetupPage.test.tsx`
Expected: the first test FAILS (no `preferences/save` call); the second passes already.

- [ ] **Step 3: Implement**

In `SetupPage.tsx`, add the imports:

```ts
import { importSettingsPrefs } from '#components/modals/ImportTransactionsModal/importSettings';
import { useSyncedPrefs } from '#hooks/useSyncedPrefs';
```

Use the subpath entry Task 9 added for `importSettings` if it differs from the path above. In the component body:

```ts
const [, saveSyncedPrefs] = useSyncedPrefs();
```

Right after the `if (!result.ok) { ... return; }` block, before the summary is built:

```ts
// Save the column mappings so a later import into these accounts is
// already set up. Create has committed; a failure here changes nothing else.
try {
  const prefs: Record<string, string> = {};
  state.accounts.forEach((account, index) => {
    const accountId = result.accountIds[index];
    for (const file of account.files) {
      const mapping = state.mappings[file.id];
      if (accountId && mapping) {
        Object.assign(
          prefs,
          importSettingsPrefs(accountId, file.format, mapping.settings),
        );
      }
    }
  });
  if (Object.keys(prefs).length > 0) {
    saveSyncedPrefs(prefs);
  }
} catch (error) {
  console.error('Bank file setup: saving import settings failed', error);
}
```

`saveSyncedPrefs` takes the same object the import dialog passes to its `savePrefs` in Task 9. If the type checker rejects `Record<string, string>` for `SyncedPrefs`, type `prefs` the way Task 9 types the dialog's argument, not with `as`.

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn workspace @actual-app/web run test src/components/bank-file-setup/SetupPage.test.tsx`
Expected: PASS, and every earlier SetupPage test still passes.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
yarn typecheck
yarn lint:fix
git add packages/desktop-client/src/components/bank-file-setup/SetupPage.tsx \
  packages/desktop-client/src/components/bank-file-setup/SetupPage.test.tsx
git commit -m "[AI] Save the new accounts' import settings after setup"
```

---

## Deliberate differences from the spec

- **The summary after Create is announced by the notification, not the live region.** The page's region unmounts when Create navigates away. The notification uses the existing assertive `role="alert"`; D9's second channel is dropped.
- **QIF files take the "Needs columns" path**, because their dates need a chosen date format. The mapping modal is heavier than a QIF needs. Chase does not export QIF for this flow, so it is left as is.
- **"Drop a QFX anywhere on the page" is not built.** Dropping works on each account card.
- **No onboarding snapshot is regenerated.** The design expected it; none of the six existing onboarding snapshots shows a screen this plan changes. Task 12 confirms that in Docker and adds only its own snapshots.
- **Inserts inside Create's batch are awaited one at a time.** D6 said "no awaiting between inserts"; starting them together is unsafe, because an insert still in flight after a throw would send its messages outside the discarded batch.
- **The generator-based regression check is out of this plan.** The sample-data generator is on the unmerged `sample-data-generator` branch.
- **The Add account entry reads "Set up from bank files"** (D8), not the PRD's "From bank files". The local account form's lead-in, "Starting from files you downloaded from your banks?", is new copy.
