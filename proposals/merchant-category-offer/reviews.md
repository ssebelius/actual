# Review record: Categorize a merchant everywhere at once

The PRD had one review pass on 2026-09-27 from two reviewers working in
parallel: a product review (problem, scope, decisions, trust risks) and a
research review (every claim about Actual checked against the code, plus how
comparable apps behave). Neither found a blocking issue. The product review
confirmed the problem and the chosen option.

Findings are recorded with what was done about them. "Adopted, to confirm"
marks a reviewer proposal that changes product behavior; it is in the PRD but
is not yet an owner decision.

## Decisions to confirm

Owner decisions on 2026-09-27: decision 1 confirmed; decision 2 confirmed;
decision 3 changed, so Undo restores the state from before the edit,
including the edited row; decision 4 changed, so "include" is always offered
when other categories exist and always goes through a row review. UX
direction B chosen.

| #   | Proposal                                                                                                                                                                      | Source                 | Why it was adopted                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | When an offer is shown, the silent learner waits for the answer: Apply saves the rule, an explicit decline learns nothing, and no answer lets the learner run (Requirement 2) | Product, revised by UX | The product review proposed skipping the learner whenever an offer shows, so that declining really declines. The UX review found that in the transaction table Enter saves and moves on, so most offers would close unanswered and people would learn less than today. |
| 2   | Offer only when the payee has at least one other transaction (Requirement 1)                                                                                                  | Product                | Offering whenever no rule exists interrupts nearly every edit in a fresh budget, including one-off merchants. The cost is that a new merchant gets its rule on the second purchase instead of the first.                                                               |
| 3   | Undo reverts the Apply step only, and only while Apply is the latest change (Requirement 7)                                                                                   | Product                | Actual's undo is one global stack and the row edit is its own step, so an Undo button left on screen after further edits would revert the wrong change.                                                                                                                |
| 4   | Show "include" only when the other categorized rows share one category (Requirement 4)                                                                                        | Product                | "Include 14 with other categories" is a blind overwrite that strains the goal of never overwriting a choice without an explicit decision.                                                                                                                              |

## Corrections and additions

| Finding                                                                                                                        | Source                                        | Change made                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Run Rules on a selection already reapplies rules to existing transactions                                                      | Research                                      | Corrected "What the rule does"; added to the do-nothing alternative                                           |
| Create rule pre-fills the raw bank description and an approximate amount, not the payee alone                                  | Research, verified in `Account.tsx`           | Corrected the manual route                                                                                    |
| Notifications hold one button and inline links, no checkbox                                                                    | Research, verified in `notificationsSlice.ts` | Stated as a constraint for the UX pass                                                                        |
| Split children have their own payee, copied from the parent                                                                    | Research                                      | Corrected the split edge case                                                                                 |
| An on-budget to off-budget transfer keeps its category                                                                         | Research                                      | Transfer payees are excluded explicitly                                                                       |
| A more specific rule still decides the category for what it matches, and the learner's rule lookup also returns "is not" rules | Research, product                             | Defined "simple rule" as the learner's shape (Requirement 5); the offer says when a more specific rule exists |
| The generator cannot import a second period into an existing budget                                                            | Research                                      | Rule accuracy now uses a held-back final month, with the generator change named                               |
| "One edit per merchant" is guaranteed by the design, so it measures the implementation, not the value                          | Product                                       | Relabeled as regression checks; added a small tester trial with two stated questions                          |
| Missing alternative: announce the silent learner's rules                                                                       | Product                                       | Added to the alternatives as the fallback if the offer proves too noisy                                       |
| Precedent: Monarch and Copilot prompt; YNAB and Lunch Money learn silently; Monarch and Lunch Money preview affected rows      | Research                                      | Cited in the alternatives; row preview added as an open question                                              |
| Bulk edits and mobile never trigger the silent learner                                                                         | Product, research                             | Stated in "How it works today"; the exclusions now match current behavior                                     |
| The Chick-fil-A example depends on the generator's end date                                                                    | Research                                      | The example now names the options and end date                                                                |

## Not adopted

| Finding                                                                      | Source   | Reason                                                                                  |
| ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| The learner's look-back window runs 180 days either side of the edited dates | Research | Correct, but it changes no decision in this PRD                                         |
| Under the new sidebar design, Rules is on the main navigation                | Research | Noted as "in the default sidebar"; the silence of the learner is the problem either way |

## UX review

The UX directions had their own review pass, recorded in
[ux/directions.md](ux/directions.md#ux-review). Two of its findings changed
this PRD: the silent-learning rule in decision 1 above, and the offer copy,
which now says that a rule will be saved.
