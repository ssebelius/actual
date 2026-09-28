# Technical design: Start a budget from bank files

Status: implemented on this branch · 2026-09-28 · implements [the PRD](bank-file-setup-prd.md) and [UX direction E](bank-file-setup-ux.md) · [review record](process/bank-file-setup-reviews.md) · [implementation plan](process/bank-file-setup-plan.md)

This records the architecture decisions for the setup flow, with the
alternatives each one was chosen over. The task-by-task implementation plan
is written from this document once it is agreed.

## Summary

The flow is a new full-page route in the desktop client. The person's files
are read in the browser and parsed on the server into per-statement results,
including the bank, account number, statement dates and ledger balance that
the OFX parser throws away today. Everything the review shows (duplicates
across files, starting balances, likely transfers) is computed by pure
functions in a new shared module that both the client and the server import.
The client runs them on every edit, so the review updates without a round
trip. **Create** calls one new server handler, which checks what it was sent
with the same functions, computes every row it will write without writing
anything, and then writes them all in a single batch of sync messages. A
failure before or during that batch writes nothing, and one Undo reverts all
of it.

Nothing changes in the database schema. The existing per-account import is
left as it is.

## What the code gives us today

The research behind this is summarized here because it constrains every
decision below.

- **Parsing.** `parseFile` (`loot-core/src/server/transactions/import/parse-file.ts`)
  reads a file by path and routes by extension. OFX and QFX results carry
  `imported_id` from `FITID` and nothing about the statement. `ofx2json.ts`
  merges every statement in a file into one list and, when a file has both
  bank and card statements, keeps only the card ones. `.qbo` is rejected.
  Nothing outside the import dialog calls either function.
- **File intake.** On the web, `openFileDialog` (`browser-preload.js:193`)
  takes one file, renames it to `file.<ext>` and uploads it to `/uploads/`,
  so two CSVs overwrite each other. No drag and drop exists anywhere.
- **CSV mapping** runs in the client: `utils.ts` in `ImportTransactionsModal/`
  has the pure mapping, date and amount functions, and `FieldMappings`,
  `DateFormatSelect`, `InOutOption` and `MultiplierOption` are separate
  components. The modal itself is `@ts-strict-ignore`, keys its saved
  settings by account id, previews by calling the server for an existing
  account, and writes when it closes. `FieldMapping` has no balance field.
- **Import** (`reconcileTransactions`, `accounts/sync.ts:635`) runs rules,
  creates payees and skips rows already in the database, by `imported_id` or a
  same-amount match within 7 days. It never compares rows in the same input
  with each other.
- **Starting balance.** `createAccount` dates it today. Bank sync computes
  current balance minus the downloaded transactions, inline in
  `processBankSyncDownload`, not as a reusable function.
- **Atomicity.** Every write becomes CRDT messages. `batchMessages`
  (`sync/index.ts:701`) buffers them and applies them in one SQLite
  transaction; a throw inside it discards the buffer, so nothing is written or
  synced. But reads inside a batch do not see the batch's own writes, and
  `createAccount`, `batchUpdateTransactions`, `createPayee` and
  `insertAccount` all read the database to decide what to write (existing
  payees by name, existing sort orders, the rows just inserted). Wrapping them
  in one batch
  would silently skip transfer handling, duplicate payees and give new
  accounts the same sort order.
- **Undo.** A handler wrapped in `mutator(undoable(...))` records one marker,
  and nested undoables add none, so one Undo reverts everything the handler
  wrote. History is in memory and cleared when a budget loads.
- **Transfers.** "Make transfer" sets `transfer_id` on both rows, sets each
  payee to the other account's transfer payee and clears the category. Rows
  inserted with a transfer payee and transfer processing on get a third,
  duplicate counterpart row.
- **Accounts** have no type or bank in the app schema. The table has bank-sync
  columns (`type`, `mask`, `bank`) that the schema does not expose.
- **First run.** `createBudget` does not navigate; the app lands on `/budget`,
  which has no empty state. `TourAutoOffer` posts a "Take the tour"
  notification on first mount. The accounts empty state only shows on
  `/accounts`. Without a sync server, Add account skips its choice screen and
  opens the local account form.
- **Screen readers.** No `aria-live` region exists in the app, and
  notifications use the assertive `role="alert"`.

## Decisions

### 1. The flow is a full-page route

A new route, `/setup`, in `FinancesApp`, wrapped in `NarrowNotSupported`. It
holds the "How do you want to start?" choice as its first state and then the
direction E page. All of the flow's state (draft accounts, parsed files,
mappings, entered balances, transfer answers) lives in one reducer on that
page. Leaving the page discards it, after the confirmation the UX review asked
for once any account has been added.

| Option                                                    | Why not                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A modal over `/budget`                                    | Direction E is a long page with its own modal (column mapping) on top; modal-on-modal is awkward and the modal system is a stack |
| Ask the question in the manager, before the budget exists | Modals there are gated on a budget id, and Requirement 2 needs the same flow inside existing budgets                             |

### 2. Files are read in the browser and parsed from their contents

The page takes files through react-aria's `FileTrigger` (multi-select) and
`DropZone`, both already available through `react-aria-components`. It reads
each `File` into bytes and sends `{ name, bytes, options }` to a new server
handler, `setup-parse-file`, as soon as the file is added. `parseFile` is
split so that the format routing works on contents; the existing
path-based entry point becomes a thin wrapper, and the per-account import is
untouched.

| Option                                                                           | Why not                                                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `openFileDialog`; fix the web preload to keep names and allow several files | Touches the preload on both platforms, still leaves drag and drop needing a separate path, and keeps the filename-collision class of bug |
| Parse in the browser                                                             | The parsers live in loot-core's server side with their dependencies (`xml2js`, CSV parser); moving them is a larger change               |

`setup-parse-file` is a plain handler, not a mutator, so parsing does not
queue behind writes (the existing `transactions-parse-file` is a mutator).
CSV, OFX and CAMT already decode from bytes; QIF is read as text today, so
the bytes entry point decodes it as UTF-8. Byte arrays cross the worker
connection by structured clone on both web and Electron, with no JSON step.

For Requirement 4's duplicate-file warning, the client hashes each file's
bytes with SHA-256 (`crypto.subtle`) and compares hashes across the flow.

### 3. The OFX parser returns statements

`ofx2json` gains a `statements` result: one entry per `STMTTRNRS`,
`CCSTMTTRNRS` or `INVSTMTTRNRS`, each with its transactions and `{ org, fid, bankId,
accountId, accountType, start, end, ledgerBalance, ledgerDate }`. Every
message set in the file is read, which fixes the mixed-file bug. The flow
offers bank and card statements as accounts and lists an investment statement
as not supported, since investment accounts are outside the PRD. `parseFile`
adds the field alongside the existing `transactions`, which stays as the
merged list so the import dialog behaves exactly as before. `.qbo` routes to
the OFX parser.

This is the one change shared with existing behavior, and the one place a
regression would reach current users. It is covered by the existing snapshot
tests plus new fixtures: a two-statement file, a mixed bank and card file, a
QBO file, and the existing `html-vals.qfx`, whose ledger date falls after its
statement end. A test pins that the merged `transactions` result is unchanged
for every existing fixture, including the order of precedence (card, then
investment, then bank) it uses today.

### 4. CSV mapping is extracted, not wrapped

A new, type-strict `CsvMappingModal` for the flow composes the existing
`FieldMappings`, `DateFormatSelect`, `InOutOption` and `MultiplierOption`
components and the pure functions in `utils.ts`. It takes one parsed file and
returns a mapping; it never imports, and it does not read or write saved
settings. `FieldMapping` gains an optional `balance` column for Requirement 6.
After **Create**, the flow writes the same saved settings the import dialog
writes (`csv-*`, `parse-date-<id>-<type>`, `flip-amount-<id>-<type>`,
`import-notes-<id>-<type>` and the `ofx-*` options) under each new account's
id, so a later per-account import of the same bank's files is already set up.
One helper builds that key set, extracted from the dialog's save code
(`ImportTransactionsModal.tsx:724-774`) so the two cannot diverge.

| Option                                             | Why not                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Open the existing import modal                     | It requires an existing account, previews and writes against it, and closes on import                                       |
| Refactor the existing modal onto the new component | The right end state, but it touches a large strict-ignore file for no user-visible gain in this change; left as a follow-up |

The cost is two surfaces that configure CSV mapping until the follow-up is
done. Both use the same field components and pure functions, so they can only
drift in layout.

### 5. The review is computed by shared pure functions

A new file, `loot-core/src/shared/bank-file-setup.ts`, holds the flow's logic
as pure functions over plain data, with no database access. (A single file,
because the package's `./shared/*` export maps to one `.ts` file, not a
directory.) Every row the client holds has a stable id, assigned when its
file is parsed.

- `dedupeAcrossFiles(files)`: Requirement 7. Rows are compared only across
  files, never within one, because two identical coffees in one statement are
  two purchases. Rows match on `imported_id` when both have one. Otherwise
  they match on date, amount and description as a multiset: for each key, the
  account keeps the largest count found in any single file, and the extra
  copies from other files are skipped. Returns the kept rows and the skipped
  ones with the file each came from.
- `startingBalance({ transactions, known })`: Requirement 8. `known` is the
  balance with its date and source. Returns the amount and its date (the
  earliest transaction), or a reason it cannot be computed yet: no balance, or
  a ledger balance dated after the statement end.
- `findTransferPairs(accounts)`: Requirement 10. Opposite signs, same amount,
  within 5 days, different accounts, each row in at most one pair. The
  matching is greedy, so it is run once per change in the client and its
  output is identified by row ids.
- `validateTransferPair(a, b)`: the same conditions, for one given pair.
- `buildReview(draft)`: the per-account rows and the blockers the footer
  lists (needs columns, needs a balance).

The client imports these and recomputes the review on every edit, which is
what makes direction E's "updates as you edit" cheap. **Create** sends the
confirmed pairs as pairs of row ids, and the server checks each one with
`validateTransferPair` rather than finding pairs again, which could pair rows
differently from what the person confirmed. The server also re-runs
`dedupeAcrossFiles` and `startingBalance` on what it receives. That checks the
arithmetic, not the inputs: CSV rows are mapped in the client, so the server
necessarily trusts the client's amounts, as the existing import does.

| Option                                                 | Why not                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Compute the review on the server, on every edit        | A round trip per keystroke in a balance field, and parsing already hands the client everything needed       |
| Compute it only in the client                          | **Create** would write client-computed balances unchecked, and the logic would be untestable from loot-core |
| Run `transactions-import` with `isPreview` per account | It needs an existing account and compares only against the database, which is empty for new accounts        |

The review does not run rules. Rules only change payees, categories and
notes, none of which the review shows, and they cannot be evaluated properly
before the accounts exist. They run at **Create**.

### 6. Create computes everything, then writes once

A new handler, `setup-create`, registered as `mutator(undoable(...))` in a new
`server/bank-file-setup/app.ts`. It takes the draft: accounts with their names,
on-budget flags, rows with their ids, known balances and confirmed transfer
pairs.

**Step 1: compute, reading but never writing.** Load existing accounts,
payees and rules. Validate the draft with the shared functions. Then build
every row in memory:

- Ids for everything: accounts, transfer payees, the "Starting Balance" payee
  if missing, each new payee and every transaction.
- Payees resolved by normalized name against one in-memory map that holds the
  existing payees and every payee this step creates, so a name used in two
  accounts, or by a rule, becomes one payee.
- Rules run per transaction against an accounts map that includes the new
  accounts. `runRules` today writes when a rule sets a payee name
  (`resolvePayeeNameForRules` calls `insertPayee`, `transaction-rules.ts:1192`),
  which would commit outside the batch. It gains an option to leave such a
  payee unresolved as a name, and step 1 resolves it against the in-memory
  map. Rule templates that read a running balance evaluate to 0 for the new
  accounts, which have no rows yet; that is how a first import behaves today.
- A rule that returns subtransactions makes a split with the existing
  `makeSplitTransaction`. Split children are not considered for transfer
  pairs, which are confirmed before rules run.
- The fields the existing write paths set, replicated here and named so the
  build does not miss one: category null for off-budget accounts and for split
  parents; transaction `sort_order` as `now - i * TRANSACTION_SORT_INCREMENT`;
  `cleared` true, as import sets it; account `sort_order` placed after the
  existing accounts within the on-budget or off-budget group, as
  `insertAccount` does.
- Confirmed transfer pairs pre-linked: `transfer_id` on both sides, each
  payee set to the other account's transfer payee, the category cleared by
  the server rule in `transfer.ts` (only when both accounts are on budget or
  both off). A rule that sets a transfer payee on an imported row gets its
  counterpart row computed here, as `transfer.onInsert` would, with `cleared`
  false and rules run on it, as `addTransfer` does.

**Step 2: write, never reading.** One `batchMessages` that calls only
`db.insertWithUUID`, `db.insertPayee` and `db.insertTransaction` with the
precomputed values. It never calls `createAccount`, `insertAccount`,
`createPayee` or `batchUpdateTransactions`: all of them read inside the
batch, where the batch's own writes are invisible, and
`batchUpdateTransactions` would silently skip category clearing for the new
accounts. Raw inserts run no transfer logic, so every transfer written is
exactly the one computed.

A throw in step 1 writes nothing. A throw in step 2 discards the batch. The
batch's single `applyMessages` runs in one SQLite transaction, so a failure
there rolls back too. On any of these the handler returns the error and the
page stays open with the draft intact (Requirement 12).

Some work runs after the commit: budget recalculation, sync listeners and the
saved import settings. If any of it throws, the data is already written, and
reporting a failure would invite a retry that creates every account twice.
So once the batch has committed, the handler catches and logs such errors and
returns success with a warning; the settings write has its own guard.

| Option                                                                       | Why not                                                                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Call `account-create` and `transactions-import` per account                  | Not atomic: each call commits and schedules sync on its own, so a failure leaves some accounts created                                          |
| The same calls inside one outer `batchMessages`                              | Atomic, but the helpers read back their own writes: transfers and off-budget handling silently don't run, payees duplicate, sort orders collide |
| Create a new budget file and discard it on failure, as the YNAB importers do | Does not work inside an existing budget (Requirement 2), and loses undo                                                                         |
| Run the existing calls and delete what was created if one fails              | The deletes are new sync messages; other devices would see the budget appear and disappear                                                      |

Two costs are accepted. First, step 1 duplicates parts of existing logic:
payee name normalization, the starting-balance payee lookup, the field
defaults above and the transfer counterpart. Each is extracted from its
current home into a pure function where that is a small change and called
from both places; otherwise it is copied with a test that compares the two.
Second, `IS_BATCHING` is global: a non-mutator handler that writes while
step 2 is running would join the batch. Step 2 does no awaiting between
inserts, which keeps that window as small as the existing batched writes
elsewhere.

### 7. Account type and bank are not stored

Type (checking, savings, credit card, other) lives only in the flow. It
decides whether a balance is asked for as an amount owed and how review shows
it. The bank prefills the account name and nothing else.

| Option                                    | Why not                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Add `type` and `bank` columns to accounts | A migration, sync schema, API and every account form for information only this flow uses today |

The consequence is that a later per-account import cannot tell a card from a
checking account. That is how it works today, so nothing regresses.

### 8. Entry points and first run

- **Start budgeting and Create new file.** `createBudget` gains an option to
  navigate to `/setup` after the budget loads. Both `WelcomeScreen` and
  `BudgetFileSelection` pass it on wide screens; on narrow screens they do not,
  and the person lands on today's empty budget.
- **The empty budget.** `/budget` gets a small empty state for budgets with no
  accounts, offering the flow. None exists there today.
- **Add account.** "Set up from bank files" is added to `CreateAccountModal`
  and, because that modal skips straight to the local account form when there
  is no sync server, to `CreateLocalAccountModal` as a link above its form.
  Both are hidden on narrow screens.
- **The tour.** `TourAutoOffer` does not post while the route is `/setup`, and
  posts after the person leaves it by **Create** or by starting empty.

### 9. Announcements

A small `LiveRegion` component (a visually hidden `role="status"`,
`aria-live="polite"` element and a hook to post a message to it) is added to
`desktop-client`. The flow uses it for parse results, blockers appearing and
clearing, recomputed starting balances and the result of **Create**. It is
new because nothing like it exists; notifications stay as they are.

After **Create**, the page navigates to `/categories/uncategorized` and posts
the summary as an ordinary notification. It is also written to the live
region, since notifications are assertive.

### 10. Rules at Create, and performance

Requirement 15 (5,000 transactions reviewed within 2 seconds) applies to
parsing and the review, which run no rules and no database queries after
parsing, so it is expected to hold. **Create** is where the cost is: rules for
every transaction in step 1, and roughly 60,000 to 75,000 CRDT messages
applied in step 2 for 5,000 transactions. Both are estimates. The first task
of the build is a spike that measures `runRules` and `applyMessages` over
5,000 rows on the web backend.

The sync upload is not a new risk. Sync already sends every unsent message in
one request, so importing 5,000 transactions through today's per-account
import produces the same upload, and neither capping nor splitting a
**Create** would bound it. Undoing a **Create** sends about as many tombstone
messages again.

**Create** shows a busy state on its button and disables the page while it
runs.

## Testing

- **loot-core unit tests.** The OFX statements result against the new and
  existing fixtures; every shared function, including the edge cases in the
  PRD (overlapping files, ledger after statement end, card signs, a row in two
  candidate pairs); and `setup-create` against a real test database: accounts,
  transactions, starting balances and transfers as expected, one undo marker,
  a forced throw during step 2 leaving the database and the sync queue
  unchanged; a rule that renames a payee creating no payee when step 2 throws;
  a rule that splits a transaction; a pair of confirmed row ids that no longer
  validates being rejected; and a throw after commit returning success with a
  warning.
- **Client tests** with Testing Library for the page's reducer and the
  footer's blockers, and for `CsvMappingModal` returning a mapping without
  touching saved settings.
- **End to end.** `ConfigurationPage.startFresh()` changes to pass through the
  choice, and the onboarding snapshots are regenerated in the VRT image. A new
  test sets up a budget from OFX and CSV fixtures in `e2e/data/`, confirms a
  transfer and checks balances.
- **Generated files.** The PRD's regression check needs the sample data
  generator to write OFX, QFX and CSV files. The generator is on the
  `sample-data-generator` branch, not `master`, so that check waits until it
  is merged or this branch is based on it.

## Risks

- **The OFX change reaches existing imports.** Mitigated by keeping the
  existing `transactions` result unchanged and by the snapshot tests.
- **Duplicated logic in Create drifts** from the code it copies. Mitigated by
  extracting shared pure functions where cheap and by comparison tests where
  not.
- **Create's cost at 5,000 transactions** is unmeasured. The spike comes first.
- **Step 1 misses a side effect** that an existing write path performs. The
  list in decision 6 is the checklist, and the comparison tests cover it.
- **Real Chase files** may lack a ledger balance or a checking CSV Balance
  column. The flow then asks for the balance, which it already handles; the
  design does not change.

## Open questions

- Should the per-account Import also use `startingBalance`? The PRD leaves
  this open. The shared module makes it a small, separate change later.
- Should the follow-up that moves the existing import modal onto
  `CsvMappingModal` be scheduled, or left until that modal is next touched?
