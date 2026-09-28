# UX directions: Start a budget from bank files

Status: direction E chosen and implemented on this branch · 2026-09-28 · implements [the PRD](bank-file-setup-prd.md) · [prototype](ux/bank-file-setup-prototype.html)

Decision: **E**, chosen by the owner after trying it in the prototype, in part
because the same flow serves someone who sets up from files at the start and
someone who starts blank and adds accounts later.

Recommendation, from the UX review: **E, a hybrid of A and C.** One centered
column of account cards, as in A, with the balance question inside each card.
Below the cards, C's review table stays visible and updates as the person
edits, followed by likely transfers and Create. There is no separate Review or
Done step. Dropping a QFX anywhere on the page creates a filled-in card, as a
shortcut from C, but the page starts from accounts, in the owner's order: bank,
name, files. D is ruled out (review finding 1). B is the alternative if the
owner wants the sidebar preview, at the cost of a second rendering of the
sidebar and a layout that must stack below 1100px.

All five directions implement the same PRD behavior: collect accounts with a
bank, a name, a type and files, show what will be created, create it in one
step. They differ in layout posture: where the flow lives, whether the person
starts from accounts or from files, and how much of the finished budget they
see while setting up.

Color and type are fixed by [DESIGN.md](../../DESIGN.md), so they do not
distinguish the directions. Every direction uses Inter Variable, Navy Mist
(`#e8ecf0`) page background, Surface White (`#ffffff`) panels with 1px Navy
Mist borders, Actual Purple (`#8719e0`) for the one primary action per screen,
and tabular figures for every amount, all through `theme.*` tokens.

- **Prototype:** [prototype.html](ux/bank-file-setup-prototype.html). Open it in a browser and
  switch directions with the tabs at the top. Sample data: Chase Checking
  (QFX), Chase Sapphire (CSV), Chime Checking (no file). Light theme only.
  Screenshots of each direction are in [screens/](ux/screens/). The prototype
  shows A to E and opens on E. Accounts arrive
  pre-filled, CSV column mapping is not shown, and the rows are made up.

## The directions

|                       | A · Guided steps                          | B · Live preview                                     | C · Files first                                 | D · Setup in the budget                                               |
| --------------------- | ----------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Where                 | Full page, replaces the budget until done | Full page, split in two                              | Full page, one drop zone then a table           | The real budget page, with a docked panel                             |
| Starts from           | An account form                           | An account form                                      | Dropping every file at once                     | An account form                                                       |
| What the person sees  | One step at a time                        | The sidebar and account list forming beside the form | Detected accounts in a table                    | The real sidebar and budget filling in                                |
| Layout                | Centered 640px column, stepper on top     | 440px form panel left, preview right, 24px gap       | 880px column; drop zone 200px tall, then table  | 360px panel docked right, bordered, full height                       |
| Review                | Its own step                              | Always visible, in the preview                       | The table is the review                         | Each account row expands                                              |
| Nothing written until | Create on the last step                   | Create under the preview                             | Create under the table                          | Create at the panel's foot; the budget behind is a preview until then |
| Build cost            | Low to medium                             | Medium                                               | Medium: grouping files needs the new OFX fields | High: a preview state for the real budget page                        |

### A · Guided steps

Three steps under a small stepper: **Accounts**, **Review**, **Done**. The
Accounts step is a list of account cards, each with Bank, Account name, Type
and a file slot, and an "Add another account" button below. Review is a
compact table, one row per account: name, transactions, dates, duplicates
dropped, starting balance, ending balance. Create sits bottom right.

The most familiar pattern and the easiest to build from the existing modal
parts. It hides the result until the Review step, so the WYSIWYG quality
arrives late.

### B · Live preview

The form on the left, the result on the right. As accounts and files are
added, the right side shows a mock of Actual's sidebar account list with each
account's balance, and under it a card per account: date range, transaction
count, starting balance on its date, ending balance. An account missing a
balance shows a gold "Needs a balance" line in the preview, with a field to
fill it in place. Create sits under the preview and is enabled when every
account is complete.

This is the most literal answer to "see it before it is created": the person
watches the sidebar they will work in take shape. The cost is a second,
simplified rendering of the sidebar that must stay truthful to the real one.

### C · Files first

The screen opens with one large drop zone: "Drop the files you downloaded from
your banks." Actual parses them and groups them into accounts, filling bank,
name and type from OFX and QFX. Files it cannot place, such as a CSV with no
account number, sit in an "Unassigned files" row with a "Which account?"
picker, including "New account". Below, a table of detected accounts works as
the review. Accounts without files, like Chime, are added with a plain "Add an
account with no file" link.

Fastest for someone with a folder of downloads, and it asks the fewest
questions when files carry account details. It depends on the new OFX fields,
and it inverts the owner's stated order (bank, name, then files), which makes
CSV-heavy setups feel like a sorting chore.

### D · Setup in the budget

No separate page. The new budget opens as today, with a 360px setup panel
docked on the right: account rows with Bank, Name, Type and files, each
expandable to its review line. As accounts are added, the real sidebar shows
them in a pending style (italic, Slate text, a "Not created yet" tooltip)
and the budget grid stays as it is. Create at the panel's foot writes
everything; closing the panel discards the pending accounts.

Keeps the person in the place they will work, so nothing new has to be learned
after setup. It is the costliest: the sidebar needs a pending state, and a
page that looks real but is not yet written risks exactly the doubt the
product principles warn about ("no visual tricks that could make users doubt
what they're seeing").

### E · Cards with a live review (recommended)

A's column of account cards (bank, name, type, on budget, files) at up to
720px wide, with each card's gold state (needs a balance, needs columns) inside
the card it belongs to. Under the cards, a table with one row per account:
name, transactions, dates, duplicates skipped, starting balance and date,
ending balance. It updates in place as cards change. Under the table, likely
transfers, then a footer with what will be created and Create. A CSV that
needs columns opens the existing column mapping modal over the page.

It keeps B's main strength, the result always in view, without a mock sidebar,
and it works down to Actual's 730px breakpoint. It loses the moment of seeing
the sidebar take shape, which the summary after Create partly replaces.

## Copy

First choice, after Start budgeting: "How do you want to start?" with **Set
up from bank files** ("Add your accounts and the files you downloaded from your
banks. Nothing is created until you confirm.") and **Start with an empty
budget**.

Balance question, when no file has one: "What was the balance on September
26?" with the help text "Use the balance on your statement or in your bank's
app for that day. Pending transactions are not in your downloaded file."

Summary after Create: "Created 3 accounts and 486 transactions. They are
uncategorized; start with the ones below. Past months will look overspent
because nothing was budgeted in them."

Duplicates: "14 duplicates skipped", a link that lists them. Card balances are
always "1,126.48 owed", never a signed amount; transfer rows say "from" and
"to" instead of a sign.

Unanswered transfers, next to Create: "1 likely transfer not answered: it will
be imported as two transactions."

## UX review

One adversarial pass on 2026-09-27 against PRODUCT.md, DESIGN.md, the PRD and
the prototype, clicked through at 1280, 1024, 768 and 390px wide, with
keyboard-only paths and contrast measured. The reviewer recommended E.

| #   | Finding                                                                                                                                                             | Severity            | Disposition                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | D's pending sidebar shows real-looking balances, marked only by italic Slate text (3.42:1, fails AA) and a hover-only tooltip, while To Budget behind it stays 0.00 | Blocking for D      | D ruled out                                                                                                                                            |
| 2   | Entering a balance re-renders the page and sends focus to the top; the new starting balance is not announced                                                        | Blocking            | For the build: update in place, keep focus, announce through a polite live region                                                                      |
| 3   | Parse results and gold states are never announced                                                                                                                   | Blocking            | For the build: a status region per card for parse results, errors and gold states                                                                      |
| 4   | A disabled Create is skipped by Tab and its reason is not linked to it; D collapses the incomplete account                                                          | Should-change       | Adopted: Create stays focusable with `aria-disabled` and a described-by reason listing the blocking accounts as links; incomplete cards never collapse |
| 5   | Warning Gold text fails contrast (3.39:1 on white) at 12 to 13px                                                                                                    | Should-change       | Adopted: Page Ink text with a gold border and icon                                                                                                     |
| 6   | Column mapping, the hard case, is not designed; C's picker offers a checking account for a card file                                                                | Should-change       | Adopted: a "Needs columns" state that blocks Create and opens the existing modal; the file picker is filtered by account type                          |
| 7   | Should an unanswered transfer pair block Create                                                                                                                     | Should-change       | Adopted: no; unanswered is imported as two transactions, said next to Create, and fixable later with Make transfer. PRD Requirement 10 updated         |
| 8   | Confirm and Keep separate do not say which pair; the pair table has no headers                                                                                      | Should-change       | Adopted: buttons labelled with the pair, table headers added                                                                                           |
| 9   | B clips amounts at 1024px because of its fixed 440px form panel                                                                                                     | Should-change for B | Recorded for B; E is one column                                                                                                                        |
| 10  | Card balances appear as "owed" in one place and signed in another                                                                                                   | Should-change       | Adopted: "owed" everywhere for cards; transfers say "from" and "to"                                                                                    |
| 11  | A's Done step adds a click the PRD does not have                                                                                                                    | Should-change       | Adopted: removed in E                                                                                                                                  |
| 12  | The summary omits the past-months line the PRD asks for                                                                                                             | Should-change       | Adopted in the copy                                                                                                                                    |
| 13  | D's close button discards all setup work with no confirmation                                                                                                       | Should-change for D | Adopted for every direction: closing asks for confirmation once any account has been added                                                             |
| 14  | Red used for a non-money label                                                                                                                                      | Consider            | Adopted: Slate                                                                                                                                         |
| 15  | Remove buttons do not name what they remove                                                                                                                         | Consider            | Adopted                                                                                                                                                |
| 16  | "Repeats" is not Actual's word; the import dialog says duplicates                                                                                                   | Consider            | Adopted: "duplicates skipped"; PRD updated                                                                                                             |
