# UX directions: Start a budget from bank files

Status: draft for the owner to choose · 2026-09-27 · implements
[the PRD](../PRD.md)

All four directions implement the same PRD behavior: collect accounts with a
bank, a name, a type and files, show what will be created, create it in one
step. They differ in layout posture: where the flow lives, whether the person
starts from accounts or from files, and how much of the finished budget they
see while setting up.

Color and type are fixed by [DESIGN.md](../../../DESIGN.md), so they do not
distinguish the directions. Every direction uses Inter Variable, Navy Mist
(`#e8ecf0`) page background, Surface White (`#ffffff`) panels with 1px Navy
Mist borders, Actual Purple (`#8719e0`) for the one primary action per screen,
and tabular figures for every amount, all through `theme.*` tokens.

- **Prototype:** [prototype.html](prototype.html). Open it in a browser and
  switch directions with the tabs at the top. Sample data: Chase Checking
  (QFX), Chase Sapphire (CSV), Chime Checking (no file). Light theme only.

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

## Copy

First choice, after Start budgeting: "How do you want to start?" with **Set
up from bank files** ("Add your accounts and the files you downloaded from your
banks. Nothing is created until you confirm.") and **Start with an empty
budget**.

Balance question, when no file has one: "What was the balance on September
26?" with the help text "Use the balance on your statement or in your bank's
app for that day. Pending transactions are not in your downloaded file."

Summary after Create: "Created 3 accounts and 486 transactions. They are
uncategorized; start with the ones below."
