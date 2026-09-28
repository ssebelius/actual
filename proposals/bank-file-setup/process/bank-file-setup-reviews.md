# Review record: Start a budget from bank files

The PRD had one review pass on 2026-09-27 from two reviewers working in
parallel: a product review (problem, scope, decisions, trust risks) and a
research review (every claim about Actual checked against the code, and the
bank facts checked on the web). The product review agreed with the problem and
the chosen option and found one blocking issue, in the starting balance
calculation.

Findings are recorded with what was done about them. "Adopted, to confirm"
marks a reviewer proposal that changes product behavior; it is in the PRD but
is not yet an owner decision.

## Decisions to confirm

| #   | Proposal                                                                                                                                          | Source  | Why it was adopted                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Flag likely transfers between accounts in the flow and import confirmed pairs as transfers (Requirement 10)                                       | Product | Paying the Chase card from Chase checking is the owner's own case. Imported as two uncategorized rows, the payment is easy to categorize as spending, which counts the money twice. Owner confirmed 2026-09-27.        |
| 2   | Share the starting balance calculation with the per-account Import (Requirement 9)                                                                | Product | Without it, the trap the flow removes comes back for any account added later, Bank sync already has the calculation. Owner undecided 2026-09-27; moved to the open questions, and Requirement 9 no longer requires it. |
| 3   | Across files, drop a row without an `imported_id` only on an exact date, amount and description match, and list every dropped row (Requirement 7) | Product | The existing 7-day same-amount match would merge two real $5 coffees in the same week. Showing dropped rows keeps the goal that nothing is merged unseen. Owner confirmed 2026-09-27.                                  |
| 4   | Create is all or nothing (Requirement 12)                                                                                                         | Product | Account creation and import are separate undoable steps today. A failure part way through would leave a half-built budget for a first-time user. Owner confirmed 2026-09-27.                                           |
| 5   | Offer the flow from Add account as well as the empty state (Requirement 2)                                                                        | Product | Someone who adds one account by hand first would otherwise lose the flow. Owner confirmed 2026-09-27: "I can add or start blank and then add."                                                                         |

## Corrections and additions

| Finding                                                                                                         | Source   | Change made                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| Blocking: a ledger balance dated after the statement's end folds the missing activity into the starting balance | Product  | The flow uses the statement end date and asks for the balance as of that date (Requirement 8, new scenario) |
| Checking the ending balance proves nothing, since the starting balance is computed to make it match             | Product  | Tests compare the starting balance with the generator's opening balance and the transaction counts          |
| Chase shows a card balance as a positive amount owed                                                            | Product  | Credit cards ask for the amount owed and record it as negative                                              |
| Without a sync server, Add account opens the local account form directly                                        | Research | Corrected "How it works today"                                                                              |
| Existing deduplication compares only with saved transactions, never file against file                           | Research | Named as missing; Requirement 7 now defines matching across files                                           |
| Bank sync already computes a starting balance, dated on the oldest transaction (`sync.ts:1154`)                 | Research | Named as the calculation to reuse; the starting date moved from "the day before" to the oldest transaction  |
| Chase exports CSV, QFX, QIF and QBO, not OFX                                                                    | Research | Corrected; QBO added as an accepted extension, since it is OFX                                              |
| A Chase checking CSV likely has a Balance column                                                                | Research | Used as a known balance when mapped (Requirement 6); confirmation added to open questions                   |
| Chase likely downloads one account per file                                                                     | Research | The multi-statement case is no longer attributed to Chase                                                   |
| A file mixing bank and card statements silently loses the bank transactions today                               | Research | Requirement 5 keeps both                                                                                    |
| Uncategorized transactions do not change To Budget; overspending rolls forward only once categorized            | Research | Rewrote the past-months edge case; the summary explains past months                                         |
| Undo history is in memory and cleared when a budget loads                                                       | Research | Requirement 12 says Undo works while the budget stays open                                                  |
| "Without freezing the page" had no number                                                                       | Product  | Requirement 15 sets one                                                                                     |
| The no-file fallback dates its balance today, so later imported history re-creates the trap                     | Product  | Open with decision 2. Chime and PDF statements were dropped from scope by the owner on 2026-09-27           |

## Not adopted

| Finding                                                                        | Source   | Reason                                                                             |
| ------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------- |
| How far back Chase downloads go (sources say one year to seven years)          | Research | Unverified, and the six-month scenario works under any of them                     |
| The All Accounts page already has a "Let's add your first account" empty state | Research | True, but a new budget opens on the budget page, so it does not change the problem |

## UX review

The UX directions had their own review pass, recorded in
[the UX directions](../bank-file-setup-ux.md#ux-review). Three of its findings changed
this PRD: an unanswered transfer pair no longer blocks Create (Requirement
10), an unmapped CSV does (Requirement 6), and "duplicates skipped" replaces
"repeats".

## Technical design review

[The technical design](../bank-file-setup-tdd.md) had one engineering review on
2026-09-27, checking every claim against the code and the atomic Create in
particular. Verdict: sound with changes. All findings were adopted; none
changes product behavior, so none needs an owner decision.

| #   | Finding                                                                                                                                 | Severity      | Change made                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | `runRules` inserts a payee when a rule sets a payee name, which commits outside the batch and can duplicate a payee step 1 is creating  | Blocking      | `runRules` gains an option to leave the name unresolved; step 1 resolves it in memory; test with a forced throw |
| 2   | "Transfer processing off" is not a switch, and `batchUpdateTransactions` inside the batch would skip category clearing for new accounts | Should-change | Step 2 names the only calls it may use; step 1 lists every field default it replicates                          |
| 3   | Rules can split a transaction                                                                                                           | Should-change | Step 1 uses `makeSplitTransaction`; split children are not considered for transfer pairs                        |
| 4   | A throw after the commit would be reported as a failure, inviting a retry that duplicates every account                                 | Should-change | After commit, errors are logged and Create returns success with a warning                                       |
| 5   | Re-deriving transfer pairs on the server can pair different rows from those confirmed                                                   | Should-change | Pairs are sent as row ids and validated, not re-derived; the design says the server trusts client amounts       |
| 6   | The no-id duplicate rule would collapse identical purchases in one file                                                                 | Should-change | Rows compare only across files, as a multiset                                                                   |
| 7   | The OFX parser also reads investment statements                                                                                         | Consider      | Included in `statements`, listed as not supported; merged result pinned by a test                               |
| 8   | Saved import settings go beyond `csv-*`                                                                                                 | Consider      | The full key set, built by one helper extracted from the dialog                                                 |
| 9   | The sync upload size is not new, so the cap fallback bounds nothing                                                                     | Consider      | Spike limited to rules and apply time; cap dropped; undo size noted                                             |
| 10  | Running-balance rule templates read 0 for new accounts                                                                                  | Consider      | Accepted and stated                                                                                             |
| 11  | `./shared/*` exports map to single files, not directories                                                                               | Consider      | The shared module is one file                                                                                   |
| 12  | QIF is read as text; duplicate-file detection had no mechanism                                                                          | Consider      | QIF decoded from bytes; files hashed with SHA-256 in the client                                                 |
| 13  | The existing parse handler is a mutator; `createPayee` reads by name rather than reading back its write                                 | Consider      | Wording corrected                                                                                               |
