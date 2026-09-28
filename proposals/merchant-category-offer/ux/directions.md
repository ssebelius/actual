# UX directions: Categorize a merchant everywhere at once

Status: reviewed; awaiting the owner's pick · 2026-09-27 · implements
[the PRD](../PRD.md)

Recommendation: **B, the inline strip**, with D's review panel shown only
when the person chooses to change rows they already categorized. C is ruled
out. A is the fallback if B's table work proves too costly.

All four directions implement the same PRD behavior. They differ in where the
offer appears, when the person decides, and how much they see before
deciding. The visual language is fixed by [DESIGN.md](../../../DESIGN.md):
Actual's semantic tokens, Inter, Actual Purple for the primary action only,
borders for persistent surfaces and shadows for transient ones.

- **Prototype:** [prototype.html](prototype.html). Open it in a browser and
  switch directions with the tabs at the top. Clicking any category cell opens
  the picker. It shows the light theme only.
- **Walkthrough video:** [demo.webm](demo.webm), 96 seconds, plays in Chrome.
  It performs the same edit in each direction, setting the April 17
  Chick-fil-A purchase to Fast food in the family sample, and shows B's review
  path. Rebuild it with `node proposals/merchant-category-offer/ux/record-demo.mjs`
  from the repository root.

## The directions

|                          | A · Notification                               | B · Inline strip                                         | C · In the picker                                              | D · Review popover                |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| Where                    | Bottom right, where notifications appear today | A band directly under the edited row                     | Footer of the category dropdown                                | Panel anchored to the edited cell |
| When the person decides  | After the edit saves                           | After the edit saves                                     | While choosing the category                                    | After the edit saves              |
| What they see first      | One sentence and a count                       | One sentence and a count                                 | A button with a count                                          | Every row that would change       |
| Surface                  | Transient, large shadow                        | Persistent, notice fill and border, no shadow            | Transient, inside the existing dropdown                        | Transient, large shadow           |
| Include categorized rows | Checkbox, off                                  | Checkbox, off; checking it offers a review of those rows | Not offered                                                    | Per-row checkboxes, off           |
| Keyboard                 | Focus stays in the table; announced politely   | After an Enter save, focus moves to Apply                | Enter for this row, Shift+Enter for all (conflicts, see below) | Focus moves into the panel        |
| Build cost               | Low: extend the notification type              | Medium: an extra row in the virtualized table            | Low to medium: the picker already takes a footer               | Medium: a new popover with a list |
| Review verdict           | Sound fallback                                 | Recommended, with fixes applied                          | Ruled out                                                      | Too heavy as the default          |

### A · Notification

The offer arrives in Actual's notification area, bottom right, 400px wide:
title "Chick-fil-A → Fast food", the offer sentence, an "Include 10 marked
Dining Out" checkbox, then Apply (primary) and Just this one (bare). The
confirmation replaces it in place, with Undo and View rule.

It reuses the most existing UI. It sits far from the row the person is
editing, and in a short table it can cover the lowest rows. The notification
type holds one button and no checkbox today, so it needs a second button and
an option, and it must stay until answered. Focus stays in the table and the
offer is announced politely; today's notifications use the assertive
`role="alert"`, which would interrupt a screen reader mid-edit.

### B · Inline strip (recommended)

The offer opens as a band directly under the edited row, spanning the table:
the sentence and the checkbox on the left, Apply and Just this one on the
right. It uses Actual's notice colors (`noticeBackgroundLight` fill,
`noticeBorder` rules), the same family as its informational notifications,
so it does not look like a hovered row. It has no shadow because it stays
until answered.

- **Keyboard.** In the transaction table, Enter saves a cell and moves to the
  next row. When an offer appears after an Enter save, focus goes to the
  strip's Apply button instead. Apply, Just this one and Escape return focus
  to where the table would have gone. After a mouse edit, focus stays where it
  was.
- **Screen readers.** The offer sentence, and later the confirmation, are
  announced through one polite live region.
- **Include.** Checking "Include 10 marked Dining Out" reveals "Review these
  10", which opens D's panel anchored to the strip with those rows ticked. The
  preview appears only in this case, because overwriting the person's own
  choices is the risk the PRD cares about; uncategorized rows are covered by
  Undo.
- **After Apply.** The changed rows take the table highlight color
  (`tableRowBackgroundHighlight`) for a moment, as a color transition, never a
  layout animation. The strip shows the confirmation with Undo, View rule and
  Dismiss.
- **Walking away.** Editing another row or navigating away closes the strip
  without an answer, and Actual's existing silent learning runs as usual. Only
  an explicit Just this one or Escape counts as declining.

The cost is engineering: the transaction table is virtualized, so the band
changes row measurement and scrolling, and it pushes the rows below it down
while open. It also needs checking in the dark and midnight themes, which the
prototype does not show.

### C · In the picker (ruled out)

Choosing a category with Enter or a click sets this row only. A footer button,
"Also set 1 uncategorized Chick-fil-A and save a rule", or Shift+Enter, sets
the category on the uncategorized rows and saves the rule.

It asks for the decision before the person sees its effect and adds weight to
the most-used control on every edit. The deciding problem is that Shift+Enter
already means "save and move up" in the transaction table
(`packages/desktop-client/src/components/table.tsx`), so habit would bulk-edit
rows and save rules by accident.

### D · Review popover

A panel opens beside the edited cell listing every other Chick-fil-A
transaction with its date, current category and amount. Uncategorized rows
are ticked, Dining Out rows are listed unticked, and the button counts the
selection: "Apply to 1 and save rule".

It is the clearest statement of what will change, and too heavy as the
default for what is usually a one-click decision on one row. Its list is kept
for the one case that carries real risk, as B's review path.

## Copy

Offer, with uncategorized rows: "Also set 1 other uncategorized Chick-fil-A
transaction to Fast food, and save a rule to use Fast food for Chick-fil-A
from now on?" With none: "Save a rule to use Fast food for Chick-fil-A from
now on?" The sentence names the rule before Apply, because what Actual
remembers should be visible before it is remembered, and so the person with a
mixed-use merchant can see what they are agreeing to.

Confirmation: "Updated 1 transaction and saved a rule: Chick-fil-A → Fast
food." Actions: Undo, View rule, Dismiss.

## UX review

One adversarial pass on 2026-09-27 against PRODUCT.md, DESIGN.md, the PRD
and the prototype, including keyboard checks and the real table's key
handling. The reviewer agreed with B and disagreed with the first
recommendation's hybrid, which expanded the strip into a full row list for
any large backlog.

| #   | Finding                                                                                                                                                            | Severity      | Disposition                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Enter saves and moves to the next row, so closing the offer on the next edit, combined with PRD requirement 2, would dismiss most offers and learn less than today | Blocking      | Adopted: walking away is "no answer" and silent learning runs; only an explicit decline suppresses it. PRD requirement 2 changed; owner to confirm |
| 2   | "Tab from the row reaches the strip" is impossible: the table captures Tab and Enter                                                                               | Blocking      | Adopted: focus moves to Apply after an Enter save; the prototype does this                                                                         |
| 3   | The strip appears silently to screen readers                                                                                                                       | Should-change | Adopted: one polite live region for offer and confirmation                                                                                         |
| 4   | The Frost fill is the table's hover color                                                                                                                          | Should-change | Adopted: notice fill and border                                                                                                                    |
| 5   | The purple after-Apply tint reads as selection                                                                                                                     | Should-change | Adopted: table highlight token                                                                                                                     |
| 6   | The hybrid's threshold is undefined, doubles B's hardest work, and guards the low-risk case                                                                        | Should-change | Adopted: review only when including categorized rows, as D's panel anchored to the strip                                                           |
| 7   | The offer never says a rule is saved                                                                                                                               | Should-change | Adopted in all copy                                                                                                                                |
| 8   | C's "Apply to all" changes 1 of 11 rows                                                                                                                            | Should-change | Adopted in the prototype; C is ruled out regardless                                                                                                |
| 9   | Replacing an open notification offer needs a spec against the notification stack's animation                                                                       | Consider      | Recorded for A if it becomes the build                                                                                                             |

Narrow widths were not judged: the prototype breaks below about 700px, and
this version is desktop only.
