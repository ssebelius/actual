# Technical design: Categorize a merchant everywhere at once

Status: implemented on this branch · 2026-09-28 · implements [the PRD](category-offer-prd.md) and [UX direction B](category-offer-ux.md) · [review record](process/category-offer-reviews.md) · [implementation plan](process/category-offer-plan.md)

## Summary

The server decides whether an offer exists during the same call that saves
the category edit, and when it does, it holds back Actual's silent category
learner until the person answers. Three new server handlers apply the offer,
undo it, and run the held-back learner when the offer goes unanswered. On
the client, a hook next to the table's save path owns the offer's state, and
the virtualized table opens a gap after the edited row to show the strip.

The product behavior is settled in the PRD and was confirmed by the owner:
the strip under the row, the learner waiting for an answer, no offer on a
merchant's first transaction, Undo restoring the state from before the edit,
and a row review whenever already-categorized rows are included. This
document covers how that behavior is built. The owner confirmed
decisions 1 to 7 below on 2026-09-27.

## Background

Three parts of the existing code shape the design.

**The silent learner.** `updateCategoryRules` in
`loot-core/src/server/transactions/transaction-rules.ts` runs inside
`batchUpdateTransactions` when the caller passes `learnCategories`, which
only the desktop transaction table, the YNAB importers, bank-sync reconciliation
and the public API's `addTransactions` do. For each
edited payee it reads the 5 newest transactions dated between 180 days before the edited
transaction and 180 days after today; if
one category appears on 3 of them and the edited row is among the 5, it
creates or updates the rule "payee is X, set category Y". It learns silently
and never changes existing transactions.

**Undo.** Actual's undo (`loot-core/src/server/undo.ts`) records the sync
messages a handler wrapped in `undoable` produces, and reverts them as one
step; inserted rows are tombstoned. Any handler that writes transactions and
rules through the normal database layer is therefore undoable as a unit.

**The table.** The desktop transaction table is virtualized by a local
`FixedSizeList`, a fork of react-window's list in which every row has the
same height and is positioned by `index × rowHeight`. It caches each
row's position style, keyed only on the row height and layout. Keyboard navigation
lives in `useTableNavigator`: Enter saves a cell and moves editing to the
next row, and the table container captures Enter and Tab. The save does
not wait for the server: `onSave` fires the request and returns, so a
person can save the next row before the previous save's response arrives.
Server handlers still run one at a time (`runMutator` is sequential).

**Payee lookups.** In `v_transactions`, `payee` is computed by joining
`payee_mapping` on the stored `description` column, and no index covers
`description`. The learner avoids a full scan by limiting its read to a date
range that the `trans_date` index serves.

## Design

### Server

A new module, `transactions/category-offer.ts`, holds all of the offer's
server behavior.

- `getCategoryOffer(transactionId)` reads the edited transaction with its
  account and payee, applies the PRD's exclusions (no payee, no category,
  split parent, transfer payee, off-budget or closed account, learning off
  for the payee), then reads the payee's other non-parent transactions on
  open on-budget accounts through a new index on `transactions(description)`
  (decision 7). It returns `null` when there are none, or when
  none are uncategorized and a simple rule already sets this category.
  Otherwise it returns the uncategorized ids, the count of rows with other
  categories (and their category when they share one), the category of any
  simple rule it would replace, and whether a rule with more conditions also
  sets this payee's category.
- `batchUpdateTransactions` gains an `offerCategory` flag. When it is set,
  learning is on, and the call updates exactly one transaction to a
  non-empty category, it computes the offer. If there is one, it skips the
  learner and returns the offer in its result; otherwise the learner runs
  as today.
- `category-offer-apply` (undoable) changes the counted rows, or exactly the
  rows ticked in the review, and creates or updates the simple rule. It
  returns a restore snapshot: every changed row's previous category, the
  edited row's category from before the edit (sent by the client), and the
  rule's previous state.
- `category-offer-undo` (undoable) writes the snapshot back and deletes a
  created rule or restores an updated one.
- `category-offer-learn` runs the learner for one transaction, for an offer
  that went unanswered.
- `category-offer-review-rows` lists the payee's rows whose category would
  change, for the review panel.

A simple rule is the exact shape the learner creates: default stage, one
condition "payee is X", one action "set category". Apply creates or updates
only that shape, so the offer and the learner maintain the same rule rather
than competing ones.

### Client

`useCategoryOffer`, called in `TransactionList`, holds one offer at a time
in one of two states, offer or applied, and wraps the four handlers. Every
path that drops an open offer without an answer runs the learner for it
through `category-offer-learn`: a new save, a newer offer replacing it, a
global undo, and unmounting. It sends `offerCategory` for single-row
category edits and shows the returned offer only if no later save has
started; each save takes a sequence number, and a response from an older
save runs the learner for its offer instead of showing it. That keeps a
slow response from putting a strip under a row the person has left, or
from taking focus while they type in another row.

`TransactionsTable` renders the strip through a new `gap` prop on `Table`
and `FixedSizeList`, which adds the strip's measured height to the offsets
of every row after the anchor and includes the gap in the row-style cache
key, so rows already on screen move when the gap opens, resizes or closes. If the anchor row leaves the list after a
refetch, as in the uncategorized view, the gap stays at its last index. A
persistent `aria-live="polite"` region carries the offer sentence and the
confirmation. After Apply, the changed rows use the existing `highlighted`
row prop for a short background-color transition.

## Decisions

### 1. Compute the offer inside the save call

| Option                                                       | Round trips per edit | Who decides whether the learner runs | Risk                                                                 |
| ------------------------------------------------------------ | -------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| In `transactions-batch-update` (proposed)                    | 1                    | Server, in the call that runs it     | Adds a flag to a central function                                    |
| Save with learning off, then a separate `category-offer-get` | 2 or 3               | Client, for every category edit      | A failed second call silently turns learning off for that edit       |
| Compute on the client from loaded rows                       | 1                    | Client                               | The table holds only loaded, filtered rows; rules live on the server |

Computing it in the save call keeps the learner's decision on the server
and atomic with the edit: the learner is skipped only when an offer is
actually returned. The flag defaults to off, so every other caller of
`batchUpdateTransactions` behaves exactly as before.

### 2. Hold the learner until the person answers

| Option                                                         | "Just this one" learns nothing | State held                  |
| -------------------------------------------------------------- | ------------------------------ | --------------------------- |
| Skip on the server, client runs it if unanswered (proposed)    | Yes                            | Client, one offer           |
| Run it immediately; decline deletes or reverts what it wrote   | Only by undoing a write        | Client must track the write |
| Server keeps a pending offer and runs the learner on a timeout | Yes                            | Server, across the worker   |

Running the learner at once and undoing it on decline turns a decline into
a write, and the learner may have updated a rule that already existed, so
"undo" means restoring someone's earlier rule. A server-side timeout
invents a time-based meaning for "walking away" that the PRD defines by
action (editing another row, leaving the view). The proposal needs care
with saves still in flight, which the client handles with save sequence
numbers (see Client). It costs two things. The deferred learn is not undoable, so Cmd+Z of an unanswered edit
leaves a learned rule, where today the rule is part of the edit's undo
step. And closing the app with an offer open skips that edit's learning,
because the unmount cleanup cannot reach the server once the page is gone.
Both touch the learner's silent, best-effort behavior only.

### 3. Undo by explicit restore

The owner chose that Undo restores the state from before the edit,
implemented as an explicit restore rather than two global-undo pops. The
alternatives were two pops of the global undo stack, which undoes whatever
happens to be on top and breaks as soon as anything else is recorded, and
merging the edit and Apply into one undo step, which is impossible because
the edit is saved before the offer exists. The snapshot travels to the
client with Apply's result and comes back with Undo, so the server keeps no
state. To keep a stale snapshot from overwriting newer work, the strip's
Undo disappears on the next table edit and on any global undo event.

### 4. Open a gap in the virtualized list

| Option                                               | Rows below                   | Cost                                        |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------- |
| Gap after one row in `FixedSizeList` (proposed)      | Pushed down, all visible     | Offset math in one class, about 40 lines    |
| Overlay anchored to the row, as the split error does | One or two hidden while open | Small; reuses `Popover`                     |
| Replace the list with a variable-size virtualizer    | Pushed down                  | Rewrites scrolling, anchoring and animation |
| Notification, UX direction A                         | Unaffected                   | Low, but far from the row; the UX fallback  |

The list positions rows through `getItemOffset`, the total-size and
start-index functions, scroll alignment, and a cache of each row's style. A
single gap adds its height to rows after the anchor in each of those, and
joins the cache key so rendered rows are repositioned when it changes. That
is small and unit-testable, including the case where the gap appears after
the rows have rendered.
Rows below the gap move through the list's existing reorder animation when
it opens. An overlay would hide the rows the person may be about to edit
next, which is the case direction B was chosen to avoid.

### 5. Keep offer state in a hook beside the save path

`TransactionList` owns `onSave` and the server result, so the offer's state
lives there in a hook and is passed down to the table as a prop. A Redux
slice would make a per-table, per-view state global and lose the "leaving
the view counts as no answer" rule, which depends on the table unmounting.
Keeping it in `TransactionsTable` would separate it from the save call that
produces it.

### 6. Detect a keyboard save by the Enter that leaves the row

After an Enter save, focus should move to Apply; after a mouse edit it
should stay. The table's save path does not record which key triggered it,
and threading that through every cell component would touch most of the
row code. In the category column the first Enter selects and saves while
the row stays in edit, and a second Enter moves down, so the offer usually
arrives before the move. The table therefore records which row an Enter
left (any other key or a pointer press clears it). When an Enter or
Shift+Enter moves the table off the offer's own row to the row next to it,
while the offer is still open, the table remembers that row and field,
moves focus to Apply once, and returns there on Apply, Just this one or
Escape. A click, or an Enter from any other row, keeps focus. The owner
confirmed adjacency alone; the in-app check showed it missed the
category column's two-step Enter and could fire on a click, so the Enter
condition was added during implementation.

### 7. Index the payee lookup

The offer reads all of a payee's other transactions, with no date window,
inside the save call, and the server queue is sequential. Without an index
that is a full scan of `transactions` on every single-row category edit,
and on the web backend each query is its own IndexedDB lock and commit.

| Option                                                            | Cost per edit              | Trade-off                                                                     |
| ----------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| Index `transactions(description)`, query by mapped ids (proposed) | Index lookup               | One migration; every transaction write maintains one more index               |
| Limit the read to the learner's date window                       | Range scan on `trans_date` | Misses older uncategorized rows, which the PRD's backlog case is about        |
| Compute the offer after the save returns, in a second call        | Full scan, off the save    | Still a full scan; reintroduces decision 1's split learner decision           |
| Do nothing and measure first                                      | Full scan                  | Cheap now; the cost grows with every budget's history and lands on every edit |

The query selects `transactions` rows whose `description` is any
`payee_mapping` id that maps to the payee, which the index serves, and
joins to `v_transactions` for the mapped category and flags. A test checks
the query plan uses the index. The index is created with `IF NOT EXISTS`
in a plain SQL migration, like the existing performance indexes.

## Risks and open items

- **Query cost.** Decision 7 removes the full scan, but the offer still adds
  two reads to every single-row category edit. The plan's final task times
  an edit on the seeded family budget.
- **Review list size.** The review panel renders every row that would
  change without virtualization. It appears only when someone includes
  already-categorized rows, so a very long list is unlikely but possible.
- **Themes.** The strip's notice tokens and the highlight tint have not been
  checked in the dark and midnight themes.
- **Open questions carried from the PRD.** Matching on account as well as
  payee, suppressing offers after "Just this one", and matching on the raw
  bank description are all out of scope here; none of them changes this
  design's structure.

## Testing

Server behavior is tested in loot-core against a small fixture that mirrors
the PRD's Chick-fil-A case: offer conditions and exclusions, apply with and
without ticked rows, rule creation and replacement, undo by snapshot, a
global undo reverting Apply as one step, the learner being deferred and
run later, and the payee lookup's query plan using the new index. The list gap has unit tests for offsets, total size and index
lookup, including a gap that opens after rows have rendered. The hook's
tests cover a response arriving after a later save has started. The strip, the hook and the table's focus behavior have component
tests. The seeded family budget is exercised by hand in the running app,
because loot-core tests cannot depend on the sample-data package without a
new cross-package dependency.
