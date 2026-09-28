# Merchant Category Offer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a category edit in the desktop transaction table, show an inline strip under the edited row offering to set the payee's other uncategorized transactions to that category and save a "payee is X" rule, with Undo that restores the state from before the edit.

**Architecture:** The server decides whether an offer exists as part of the existing `transactions-batch-update` call and, when it does, defers the silent learner. Three new handlers apply, undo, and (for an unanswered offer) run the deferred learner. On the client, a `useCategoryOffer` hook in `TransactionList` owns the offer's state; the table renders it as a band in a gap opened in the virtualized list after the edited row.

**Tech Stack:** TypeScript, React (React Compiler), loot-core server handlers over the worker connection, Vitest, Testing Library.

**Spec:** [PRD.md](../category-offer-prd.md) and [ux/directions.md](../category-offer-ux.md) (direction B). **Design:** [design.md](../category-offer-tdd.md) records the technical decisions and alternatives this plan implements. The owner's decisions after review are recorded in the handoff note and summarized under Global Constraints.

## Global Constraints

- Desktop transaction table only. No offer from bulk edits, mobile, or adding new transactions.
- Offer only when all hold: the edit sets a non-empty category on exactly one transaction; the "learn categories" pref is on; the payee's `learn_categories` is 1; the payee is not a transfer payee; the transaction is not a split parent; its account is on-budget and open; the payee has at least one other matching transaction; and either some are uncategorized or no simple rule already sets the payee to this category.
- "Other matching transactions": same `payee`, `is_parent = 0`, account on-budget and not closed. Split children match on their own payee.
- Simple rule: `stage` null, one condition `payee is X`, one action `set category`. Only simple rules are created or modified. `isNot` rules and rules with more conditions are never modified.
- While an offer is open the silent learner waits. Apply saves its own rule. Just this one or Escape learns nothing. Editing another transaction or leaving the view counts as no answer and runs the silent learner for the original edit.
- Apply is one undoable server step. The strip's Undo is a second, explicit restore step (not two global-undo pops) that returns the edited row, the other changed rows and the rule to their values from before the edit. Undo is offered only while Apply is the latest change.
- "Include N" is off by default. When on, Apply becomes "Review N changes" and changes happen from a row review where every row can be unticked.
- Tokens: strip fill `theme.noticeBackgroundLight`, top and bottom borders `theme.noticeBorder`, no shadow. Changed rows tint with `theme.tableRowBackgroundHighlight` as a background-color transition.
- Accessibility: the offer sentence and the confirmation are announced through one persistent `aria-live="polite"` region. Never `role="alert"`.
- Keyboard: after an Enter save moves the table to an adjacent row, focus moves to Apply. Apply, Just this one and Escape return focus to that row and field. After a mouse edit, focus stays where it was.
- Copy (exact):
  - Offer with uncategorized rows: "Also set {{count}} other uncategorized {{payee}} transaction to {{category}}, and save a rule to use {{category}} for {{payee}} from now on?" (plural "transactions")
  - Offer with none: "Save a rule to use {{category}} for {{payee}} from now on?"
  - Replacing: "This replaces the rule that sets {{payee}} to {{category}}."
  - Specific rule exists: "A more specific rule for {{payee}} can still set a different category."
  - Include: "Include {{count}} marked {{category}}" or "Include {{count}} with other categories"
  - Buttons: "Apply", "Review {{count}} changes", "Just this one"
  - Review panel button: "Apply {{count}} changes and save rule"
  - Confirmation: "Updated {{count}} transaction and saved a rule: {{payee}} → {{category}}." (plural "transactions"); with zero rows: "Saved a rule: {{payee}} → {{category}}." Actions: "Undo", "View rule", "Dismiss".
- Repo rules: run yarn from the repo root; new files are type-strict (no `@ts-strict-ignore`); user-facing strings translated; commit messages start with `[AI]`; stage only this plan's files (the working tree holds unrelated `proposals/bank-file-setup/` changes that must not be committed).

## Review Focus

1. **The edited row leaves the view after Apply.** In a filtered view such as uncategorized, the refetch after Apply removes the edited row. The confirmation should stay where the row was, not disappear or jump. Pinned in Task 4 (Table keeps the last index).
2. **A second edit while an offer is open.** The first offer closes as unanswered, runs the silent learner once, and a new offer can replace it. Never two strips and never a double learn. Pinned in Task 6.
3. **Focus stealing after the person has moved on.** Focus moves to Apply only when the table is editing a row adjacent to the anchor row. If they clicked a distant row, focus stays. Pinned in Task 6.
4. **Split parents and transfers.** A split parent is never counted or changed, a split child matches on its own payee, and a transfer payee never triggers an offer. Pinned in Task 1.
5. **Undo after something else changed.** A global undo (Cmd+Z) or any later table edit removes the strip's Undo, so it cannot restore over newer changes. Pinned in Task 6.

---

## File Structure

- Create `packages/loot-core/src/types/models/category-offer.ts`: the offer, result and restore types shared by server and client.
- Create `packages/loot-core/src/server/transactions/category-offer.ts`: computing, applying and undoing an offer, the deferred learner, and review rows. One responsibility: the offer's server behavior.
- Create `packages/loot-core/src/server/transactions/category-offer.test.ts`.
- Modify `packages/loot-core/src/server/transactions/index.ts`: `batchUpdateTransactions` gains `offerCategory` and returns `categoryOffer`.
- Modify `packages/loot-core/src/server/transactions/app.ts`: pass `offerCategory` through; register four handlers.
- Modify `packages/desktop-client/src/components/FixedSizeList.tsx` and `packages/desktop-client/src/components/table.tsx`: an optional gap after one row.
- Create `packages/desktop-client/src/components/FixedSizeList.test.tsx`.
- Create `packages/desktop-client/src/components/transactions/CategoryOfferStrip.tsx` and `.test.tsx`: the strip, confirmation and review panel.
- Create `packages/desktop-client/src/components/transactions/useCategoryOffer.ts` and `.test.tsx`: offer state and server calls.
- Modify `packages/desktop-client/src/components/transactions/TransactionList.tsx` and `TransactionsTable.tsx`: wiring, focus, highlight, live region.
- Create `upcoming-release-notes/category-offer.md`.

---

### Task 1: Compute the offer on the server

**Files:**

- Create: `packages/loot-core/src/types/models/category-offer.ts`
- Modify: `packages/loot-core/src/types/models/index.ts` (add one export line)
- Create: `packages/loot-core/src/server/transactions/category-offer.ts`
- Create: `packages/loot-core/migrations/<timestamp>_add_transaction_description_index.sql`
- Test: `packages/loot-core/src/server/transactions/category-offer.test.ts`

**Interfaces:**

- Produces: `getCategoryOffer(transactionId: string): Promise<CategoryOffer | null>`; `OTHER_ROWS_SQL` (the payee lookup, exported so its query plan can be tested); types `CategoryOffer`, `CategoryOfferResult`, `CategoryOfferRestore`, `CategoryOfferReviewRow` from `#types/models`.

- [ ] **Step 1: Add the shared types**

`packages/loot-core/src/types/models/category-offer.ts`:

```ts
import type { AccountEntity } from './account';
import type { CategoryEntity } from './category';
import type { PayeeEntity } from './payee';
import type { RuleEntity } from './rule';
import type { TransactionEntity } from './transaction';

export type CategoryOffer = {
  transactionId: TransactionEntity['id'];
  payeeId: PayeeEntity['id'];
  categoryId: CategoryEntity['id'];
  /** The payee's other uncategorized transactions */
  uncategorizedIds: Array<TransactionEntity['id']>;
  /** How many of the payee's other transactions have a different category */
  categorizedCount: number;
  /** Set when every one of those shares a single category */
  categorizedCategoryId: CategoryEntity['id'] | null;
  /** The category of a simple rule that Apply would replace */
  replacesRuleCategoryId: CategoryEntity['id'] | null;
  /** A rule with more conditions also sets this payee's category */
  hasSpecificRule: boolean;
};

export type CategoryOfferRestore = {
  transactions: Array<{
    id: TransactionEntity['id'];
    category: CategoryEntity['id'] | null;
  }>;
  createdRuleId: RuleEntity['id'] | null;
  updatedRules: RuleEntity[];
};

export type CategoryOfferResult = {
  changedCount: number;
  ruleId: RuleEntity['id'];
  restore: CategoryOfferRestore;
};

export type CategoryOfferReviewRow = {
  id: TransactionEntity['id'];
  date: string;
  amount: number;
  account: AccountEntity['id'];
  category: CategoryEntity['id'] | null;
};
```

In `packages/loot-core/src/types/models/index.ts`, add in alphabetical position:

```ts
export type * from './category-offer';
```

- [ ] **Step 2: Write the failing tests**

`packages/loot-core/src/server/transactions/category-offer.test.ts`. The fixture mirrors the PRD's Chick-fil-A case at small scale: payee `cfa` with one edited row, one other uncategorized row, and two rows marked Dining Out.

```ts
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';

import { getCategoryOffer } from './category-offer';
import {
  getRules,
  insertRule,
  loadRules,
  resetState,
} from './transaction-rules';

beforeEach(async () => {
  await global.emptyDatabase()();
  resetState();
  await loadMappings();
  await loadRules();
});

async function seed() {
  await db.insertAccount({ id: 'checking', name: 'Checking' });
  await db.insertAccount({ id: 'savings', name: 'Savings', offbudget: 1 });
  await db.insertCategoryGroup({ id: 'food', name: 'Food' });
  await db.insertCategory({ id: 'fast', name: 'Fast food', cat_group: 'food' });
  await db.insertCategory({
    id: 'dining',
    name: 'Dining Out',
    cat_group: 'food',
  });
  await db.insertPayee({ id: 'cfa', name: 'Chick-fil-A' });
  await db.insertPayee({ id: 'solo', name: 'Solo Cafe' });

  const row = (id: string, date: string, category: string | null, extra = {}) =>
    db.insertTransaction({
      id,
      account: 'checking',
      payee: 'cfa',
      date,
      amount: -1200,
      category,
      ...extra,
    });
  await row('edited', '2026-04-17', 'fast');
  await row('uncat', '2026-04-04', null);
  await row('dine1', '2026-06-01', 'dining');
  await row('dine2', '2026-07-01', 'dining');
  // Excluded: off-budget account
  await row('offbudget', '2026-05-01', null, { account: 'savings' });
}

describe('getCategoryOffer', () => {
  test('offers the uncategorized rows and counts the categorized ones', async () => {
    await seed();
    expect(await getCategoryOffer('edited')).toEqual({
      transactionId: 'edited',
      payeeId: 'cfa',
      categoryId: 'fast',
      uncategorizedIds: ['uncat'],
      categorizedCount: 2,
      categorizedCategoryId: 'dining',
      replacesRuleCategoryId: null,
      hasSpecificRule: false,
    });
  });

  test('no offer on a merchant’s first transaction', async () => {
    await seed();
    await db.insertTransaction({
      id: 'first',
      account: 'checking',
      payee: 'solo',
      date: '2026-04-01',
      amount: -500,
      category: 'fast',
    });
    expect(await getCategoryOffer('first')).toBeNull();
  });

  test('no offer when cleared to uncategorized', async () => {
    await seed();
    await db.updateTransaction({ id: 'edited', category: null });
    expect(await getCategoryOffer('edited')).toBeNull();
  });

  test('no offer when learning is off for the payee', async () => {
    await seed();
    await db.update('payees', { id: 'cfa', learn_categories: 0 });
    expect(await getCategoryOffer('edited')).toBeNull();
  });

  test('no offer for a transfer payee', async () => {
    await seed();
    await db.update('payees', { id: 'cfa', transfer_acct: 'savings' });
    expect(await getCategoryOffer('edited')).toBeNull();
  });

  test('no offer when nothing is uncategorized and the same rule exists', async () => {
    await seed();
    await db.updateTransaction({ id: 'uncat', category: 'fast' });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'cfa' }],
      actions: [{ op: 'set', field: 'category', value: 'fast' }],
    });
    expect(await getCategoryOffer('edited')).toBeNull();
  });

  test('rule-only offer when nothing is uncategorized and no rule exists', async () => {
    await seed();
    await db.updateTransaction({ id: 'uncat', category: 'fast' });
    const offer = await getCategoryOffer('edited');
    expect(offer?.uncategorizedIds).toEqual([]);
  });

  test('names a simple rule it would replace and ignores isNot rules', async () => {
    await seed();
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'cfa' }],
      actions: [{ op: 'set', field: 'category', value: 'dining' }],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'isNot', field: 'payee', value: 'cfa' }],
      actions: [{ op: 'set', field: 'category', value: 'fast' }],
    });
    const offer = await getCategoryOffer('edited');
    expect(offer?.replacesRuleCategoryId).toBe('dining');
    expect(getRules()).toHaveLength(2);
  });

  test('flags a more specific rule', async () => {
    await seed();
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'payee', value: 'cfa' },
        { op: 'is', field: 'account', value: 'checking' },
      ],
      actions: [{ op: 'set', field: 'category', value: 'dining' }],
    });
    expect((await getCategoryOffer('edited'))?.hasSpecificRule).toBe(true);
  });

  test('split parents are never counted; children match on their own payee', async () => {
    await seed();
    await db.insertTransaction({
      id: 'parent',
      account: 'checking',
      payee: 'cfa',
      date: '2026-05-10',
      amount: -3000,
      category: null,
      is_parent: 1,
    });
    await db.insertTransaction({
      id: 'child',
      account: 'checking',
      payee: 'cfa',
      date: '2026-05-10',
      amount: -3000,
      category: null,
      is_child: 1,
      parent_id: 'parent',
    });
    const offer = await getCategoryOffer('edited');
    expect(offer?.uncategorizedIds.sort()).toEqual(['child', 'uncat']);
  });
});
```

Add a test that the payee lookup is served by an index rather than a scan (import `OTHER_ROWS_SQL` too):

```ts
test('the payee lookup uses the description index', async () => {
  await seed();
  const plan = await db.all<{ detail: string }>(
    `EXPLAIN QUERY PLAN ${OTHER_ROWS_SQL}`,
    ['cfa', 'edited'],
  );
  expect(plan.map(row => row.detail).join('\n')).toMatch(/trans_description/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/core run test src/server/transactions/category-offer.test.ts`
Expected: FAIL, "Failed to resolve import ./category-offer".

- [ ] **Step 4: Implement `getCategoryOffer`**

`packages/loot-core/src/server/transactions/category-offer.ts`:

```ts
import * as db from '#server/db';
import type { Rule } from '#server/rules';
import type { CategoryOffer } from '#types/models';

import { getRules } from './transaction-rules';

type EditedRow = {
  id: string;
  payee: string | null;
  category: string | null;
  is_parent: 0 | 1;
  offbudget: 0 | 1 | null;
  closed: 0 | 1 | null;
  transfer_acct: string | null;
  learn_categories: 0 | 1 | null;
};

type OtherRow = {
  id: string;
  date: number;
  amount: number;
  account: string;
  category: string | null;
};

async function getEditedRow(transactionId: string) {
  return db.first<EditedRow>(
    `SELECT t.id, t.payee, t.category, t.is_parent, a.offbudget, a.closed,
            p.transfer_acct, p.learn_categories
     FROM v_transactions t
     LEFT JOIN accounts a ON a.id = t.account
     LEFT JOIN payees p ON p.id = t.payee
     WHERE t.id = ?`,
    [transactionId],
  );
}

// `payee` in v_transactions is computed through payee_mapping, so filtering
// on it scans every transaction. Select by the stored description instead,
// which the trans_description index serves (design decision 7).
export const OTHER_ROWS_SQL = `
  SELECT t.id, t.date, t.amount, t.account, t.category
  FROM v_transactions t
  LEFT JOIN accounts a ON a.id = t.account
  WHERE t.id IN (
      SELECT tr.id FROM transactions tr
      WHERE tr.description IN (
        SELECT pm.id FROM payee_mapping pm WHERE pm.targetId = ?
      )
    )
    AND t.id != ? AND t.is_parent = 0
    AND a.offbudget = 0 AND a.closed = 0
  ORDER BY t.date DESC`;

export async function getOtherRows(payeeId: string, excludeId: string) {
  return db.all<OtherRow>(OTHER_ROWS_SQL, [payeeId, excludeId]);
}

function isSimpleCategoryRule(rule: Rule, payeeId: string) {
  const [condition] = rule.conditions;
  const [action] = rule.actions;
  return (
    rule.stage === null &&
    rule.conditions.length === 1 &&
    condition.op === 'is' &&
    condition.field === 'payee' &&
    condition.value === payeeId &&
    rule.actions.length === 1 &&
    action.op === 'set' &&
    action.field === 'category'
  );
}

function isSpecificCategoryRule(rule: Rule, payeeId: string) {
  return (
    rule.conditions.length > 1 &&
    rule.conditions.some(
      c => c.op === 'is' && c.field === 'payee' && c.value === payeeId,
    ) &&
    rule.actions.some(a => a.op === 'set' && a.field === 'category')
  );
}

export function getSimpleCategoryRules(payeeId: string) {
  return getRules()
    .filter(rule => isSimpleCategoryRule(rule, payeeId))
    .map(rule => rule.serialize());
}

export async function getCategoryOffer(
  transactionId: string,
): Promise<CategoryOffer | null> {
  const edited = await getEditedRow(transactionId);
  if (
    !edited ||
    !edited.payee ||
    !edited.category ||
    edited.is_parent ||
    edited.offbudget ||
    edited.closed ||
    edited.transfer_acct ||
    !edited.learn_categories
  ) {
    return null;
  }

  const others = await getOtherRows(edited.payee, transactionId);
  if (others.length === 0) {
    return null;
  }

  const uncategorizedIds = others.filter(t => !t.category).map(t => t.id);
  const categorized = others.filter(
    t => t.category && t.category !== edited.category,
  );
  const categorizedCategories = new Set(categorized.map(t => t.category));

  const simpleRules = getSimpleCategoryRules(edited.payee);
  const hasSameRule = simpleRules.some(
    rule => rule.actions[0].value === edited.category,
  );
  if (uncategorizedIds.length === 0 && hasSameRule) {
    return null;
  }
  const replaced = simpleRules.find(
    rule => rule.actions[0].value !== edited.category,
  );

  return {
    transactionId,
    payeeId: edited.payee,
    categoryId: edited.category,
    uncategorizedIds,
    categorizedCount: categorized.length,
    categorizedCategoryId:
      categorizedCategories.size === 1 ? [...categorizedCategories][0] : null,
    replacesRuleCategoryId: replaced ? replaced.actions[0].value : null,
    hasSpecificRule: getRules().some(rule =>
      isSpecificCategoryRule(rule, edited.payee),
    ),
  };
}
```

If `Rule` is not exported as a type from `#server/rules`, import it the way `transaction-rules.ts` does (`import { Rule } from '#server/rules'`). If a serialized action's `value` is typed `unknown`, narrow with `String(...)` rather than `as`.

Add the index as a migration. Read `packages/loot-core/migrations/README.md` first and follow it. Name the file with a millisecond timestamp later than the newest migration (currently `1788468782000_add_messages_pending.js`), e.g. `node -e "console.log(Date.now())"`:

```sql
BEGIN TRANSACTION;

CREATE INDEX IF NOT EXISTS trans_description ON transactions(description);

COMMIT;
```

Check how `global.emptyDatabase()` builds the test schema. If it applies migrations, nothing more is needed. If it loads a prebuilt schema or database file, run the step that regenerates it (the README or `package.json` scripts will name it) so tests see the index; do not hand-edit a generated file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @actual-app/core run test src/server/transactions/category-offer.test.ts`
Expected: PASS, 11 tests. Also run `yarn workspace @actual-app/core run test src/server/migrate` (or the migrations test file the README names) to confirm the migration applies.

- [ ] **Step 6: Commit**

```bash
git add packages/loot-core/src/types/models/category-offer.ts packages/loot-core/src/types/models/index.ts packages/loot-core/src/server/transactions/category-offer.ts packages/loot-core/src/server/transactions/category-offer.test.ts packages/loot-core/migrations/*_add_transaction_description_index.sql
git commit -m "[AI] Compute the merchant category offer on the server"
```

---

### Task 2: Apply, undo, learn and review on the server

**Files:**

- Modify: `packages/loot-core/src/server/transactions/category-offer.ts`
- Modify: `packages/loot-core/src/server/transactions/app.ts`
- Test: `packages/loot-core/src/server/transactions/category-offer.test.ts`

**Interfaces:**

- Consumes: `getOtherRows`, `getSimpleCategoryRules` (Task 1).
- Produces handlers:
  - `'category-offer-apply'`: `({ transactionId, categoryId, previousCategoryId, onlyIds? }: { transactionId: string; categoryId: string; previousCategoryId: string | null; onlyIds?: string[] }) => Promise<CategoryOfferResult>`. Without `onlyIds` it changes every other uncategorized row; with it, exactly those of the payee's other rows. Undoable as one step.
  - `'category-offer-undo'`: `({ restore }: { restore: CategoryOfferRestore }) => Promise<void>`. Undoable as one step.
  - `'category-offer-learn'`: `({ transactionId }: { transactionId: string }) => Promise<void>`. Runs the silent learner for one edit.
  - `'category-offer-review-rows'`: `({ transactionId, categoryId }) => Promise<CategoryOfferReviewRow[]>`. The payee's other rows whose category differs from `categoryId`, newest first.

- [ ] **Step 1: Write the failing tests**

Append to `category-offer.test.ts` (extend the import from `./category-offer` with `applyCategoryOffer, undoCategoryOffer, learnFromCategoryEdit, getCategoryOfferReviewRows`, and import `undo` from `#server/undo` and `mutator` from `#server/mutators`, `undoable` from `#server/undo`):

```ts
async function categoryOf(id: string) {
  const row = await db.first<{ category: string | null }>(
    'SELECT category FROM v_transactions WHERE id = ?',
    [id],
  );
  return row?.category ?? null;
}

describe('applyCategoryOffer', () => {
  test('changes the uncategorized rows and creates a simple rule', async () => {
    await seed();
    const result = await applyCategoryOffer({
      transactionId: 'edited',
      categoryId: 'fast',
      previousCategoryId: null,
    });
    expect(result.changedCount).toBe(1);
    expect(await categoryOf('uncat')).toBe('fast');
    expect(await categoryOf('dine1')).toBe('dining');
    const [rule] = getRules().map(r => r.serialize());
    expect(rule.id).toBe(result.ruleId);
    expect(rule.conditions).toMatchObject([
      { op: 'is', field: 'payee', value: 'cfa' },
    ]);
    expect(rule.actions).toMatchObject([
      { op: 'set', field: 'category', value: 'fast' },
    ]);
  });

  test('with onlyIds changes exactly those rows, categorized included', async () => {
    await seed();
    const result = await applyCategoryOffer({
      transactionId: 'edited',
      categoryId: 'fast',
      previousCategoryId: null,
      onlyIds: ['dine1'],
    });
    expect(result.changedCount).toBe(1);
    expect(await categoryOf('dine1')).toBe('fast');
    expect(await categoryOf('uncat')).toBe(null);
    expect(await categoryOf('dine2')).toBe('dining');
  });

  test('replaces an existing simple rule instead of adding one', async () => {
    await seed();
    const id = await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'cfa' }],
      actions: [{ op: 'set', field: 'category', value: 'dining' }],
    });
    const result = await applyCategoryOffer({
      transactionId: 'edited',
      categoryId: 'fast',
      previousCategoryId: 'dining',
    });
    expect(result.ruleId).toBe(id);
    expect(getRules()).toHaveLength(1);
    expect(getRules()[0].serialize().actions[0].value).toBe('fast');
  });
});

describe('undoCategoryOffer', () => {
  test('restores the edited row, the other rows and removes a created rule', async () => {
    await seed();
    const { restore } = await applyCategoryOffer({
      transactionId: 'edited',
      categoryId: 'fast',
      previousCategoryId: null,
      onlyIds: ['uncat', 'dine1'],
    });
    await undoCategoryOffer({ restore });
    expect(await categoryOf('edited')).toBe(null);
    expect(await categoryOf('uncat')).toBe(null);
    expect(await categoryOf('dine1')).toBe('dining');
    expect(getRules()).toHaveLength(0);
  });

  test('restores a replaced rule to its previous category', async () => {
    await seed();
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'cfa' }],
      actions: [{ op: 'set', field: 'category', value: 'dining' }],
    });
    const { restore } = await applyCategoryOffer({
      transactionId: 'edited',
      categoryId: 'fast',
      previousCategoryId: 'dining',
    });
    await undoCategoryOffer({ restore });
    expect(getRules()[0].serialize().actions[0].value).toBe('dining');
    expect(await categoryOf('edited')).toBe('dining');
  });
});

test('a global undo reverts Apply as one step', async () => {
  await seed();
  const apply = mutator(undoable(applyCategoryOffer));
  await apply({
    transactionId: 'edited',
    categoryId: 'fast',
    previousCategoryId: null,
  });
  await undo();
  expect(await categoryOf('uncat')).toBe(null);
  expect(getRules()).toHaveLength(0);
  // The edit itself was a separate step and stays
  expect(await categoryOf('edited')).toBe('fast');
});

test('learnFromCategoryEdit runs the silent learner for one edit', async () => {
  await seed();
  // Three of the five newest are Fast food once 'dine2' changes
  await db.updateTransaction({ id: 'dine2', category: 'fast' });
  await db.updateTransaction({ id: 'dine1', category: 'fast' });
  await learnFromCategoryEdit({ transactionId: 'dine2' });
  expect(getRules()).toHaveLength(1);
});

test('review rows list the rows whose category differs, newest first', async () => {
  await seed();
  const rows = await getCategoryOfferReviewRows({
    transactionId: 'edited',
    categoryId: 'fast',
  });
  expect(rows.map(r => r.id)).toEqual(['dine2', 'dine1', 'uncat']);
});
```

If `global undo` in the test needs the undo history primed, call `clearUndo()` from `#server/undo` in `beforeEach`; check `undo.test.ts` or `sync` tests for the existing pattern and follow it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/core run test src/server/transactions/category-offer.test.ts`
Expected: FAIL, `applyCategoryOffer` is not exported.

- [ ] **Step 3: Implement**

Append to `category-offer.ts` (add imports: `batchUpdateTransactions` from `'.'`; `Rule` value import from `#server/rules`; `deleteRule, insertRule, updateCategoryRules, updateRule` from `./transaction-rules`; the result types from `#types/models`; `fromDateRepr` from `#server/models` if dates come back as integers):

```ts
export async function applyCategoryOffer({
  transactionId,
  categoryId,
  previousCategoryId,
  onlyIds,
}: {
  transactionId: string;
  categoryId: string;
  previousCategoryId: string | null;
  onlyIds?: string[];
}): Promise<CategoryOfferResult> {
  const edited = await getEditedRow(transactionId);
  const payeeId = edited.payee;
  const others = await getOtherRows(payeeId, transactionId);
  const only = onlyIds ? new Set(onlyIds) : null;
  const toChange = others.filter(t =>
    only ? only.has(t.id) && t.category !== categoryId : !t.category,
  );

  await batchUpdateTransactions({
    updated: toChange.map(t => ({ id: t.id, category: categoryId })),
    detectOrphanPayees: false,
  });

  const simpleRules = getSimpleCategoryRules(payeeId);
  let createdRuleId: string | null = null;
  const updatedRules: RuleEntity[] = [];
  if (simpleRules.length === 0) {
    createdRuleId = await insertRule(
      new Rule({
        stage: null,
        conditionsOp: 'and',
        conditions: [{ op: 'is', field: 'payee', value: payeeId }],
        actions: [{ op: 'set', field: 'category', value: categoryId }],
      }).serialize(),
    );
  } else {
    for (const rule of simpleRules) {
      if (rule.actions[0].value !== categoryId) {
        updatedRules.push(rule);
        await updateRule({
          ...rule,
          actions: [{ ...rule.actions[0], value: categoryId }],
        });
      }
    }
  }

  return {
    changedCount: toChange.length,
    ruleId: createdRuleId ?? simpleRules[0].id,
    restore: {
      transactions: [
        { id: transactionId, category: previousCategoryId },
        ...toChange.map(t => ({ id: t.id, category: t.category })),
      ],
      createdRuleId,
      updatedRules,
    },
  };
}

export async function undoCategoryOffer({
  restore,
}: {
  restore: CategoryOfferRestore;
}) {
  await batchUpdateTransactions({
    updated: restore.transactions,
    detectOrphanPayees: false,
  });
  if (restore.createdRuleId) {
    await deleteRule(restore.createdRuleId);
  }
  for (const rule of restore.updatedRules) {
    await updateRule(rule);
  }
}

export async function learnFromCategoryEdit({
  transactionId,
}: {
  transactionId: string;
}) {
  const transaction = await db.first<db.DbViewTransaction>(
    'SELECT * FROM v_transactions WHERE id = ?',
    [transactionId],
  );
  if (transaction?.category) {
    await updateCategoryRules([transaction]);
  }
}

export async function getCategoryOfferReviewRows({
  transactionId,
  categoryId,
}: {
  transactionId: string;
  categoryId: string;
}): Promise<CategoryOfferReviewRow[]> {
  const edited = await getEditedRow(transactionId);
  const others = await getOtherRows(edited.payee, transactionId);
  return others
    .filter(t => t.category !== categoryId)
    .map(t => ({ ...t, date: fromDateRepr(t.date) }));
}
```

`batchUpdateTransactions` runs `batchMessages` internally and `batchMessages` nests safely, so no outer batch is needed. In `app.ts`, add to `TransactionHandlers`:

```ts
  'category-offer-apply': typeof applyCategoryOffer;
  'category-offer-undo': typeof undoCategoryOffer;
  'category-offer-learn': typeof learnFromCategoryEdit;
  'category-offer-review-rows': typeof getCategoryOfferReviewRows;
```

and register them after `transactions-merge`:

```ts
app.method('category-offer-apply', mutator(undoable(applyCategoryOffer)));
app.method('category-offer-undo', mutator(undoable(undoCategoryOffer)));
app.method('category-offer-learn', mutator(learnFromCategoryEdit));
app.method('category-offer-review-rows', getCategoryOfferReviewRows);
```

`category-offer-learn` is deliberately not undoable: today the learned rule is part of the edit's undo step, but once deferred it would otherwise become its own invisible Cmd+Z step. The cost is that Cmd+Z of an unanswered edit leaves the learned rule; that matches the learner's silent nature and is accepted.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @actual-app/core run test src/server/transactions/category-offer.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/loot-core/src/server/transactions/category-offer.ts packages/loot-core/src/server/transactions/category-offer.test.ts packages/loot-core/src/server/transactions/app.ts
git commit -m "[AI] Add apply, undo, learn and review handlers for the category offer"
```

---

### Task 3: Return the offer from the batch update and defer the learner

**Files:**

- Modify: `packages/loot-core/src/server/transactions/index.ts:40-50, 174-186, 208-215`
- Modify: `packages/loot-core/src/server/transactions/app.ts` (`handleBatchUpdateTransactions`)
- Test: `packages/loot-core/src/server/transactions/category-offer.test.ts`

**Interfaces:**

- Consumes: `getCategoryOffer` (Task 1).
- Produces: `batchUpdateTransactions({ ..., offerCategory?: boolean })` returns `{ added, updated, deleted, errors, categoryOffer: CategoryOffer | null }`. `transactions-batch-update` accepts and passes `offerCategory`.

- [ ] **Step 1: Write the failing tests**

Append to `category-offer.test.ts` (import `batchUpdateTransactions` from `'.'`):

```ts
describe('batchUpdateTransactions with offerCategory', () => {
  async function seedLearnable() {
    await seed();
    // Two of the five newest are already Fast food, so the learner
    // would create a rule on the third
    await db.updateTransaction({ id: 'dine1', category: 'fast' });
    await db.updateTransaction({ id: 'edited', category: 'fast' });
  }

  test('returns the offer and does not run the learner', async () => {
    await seedLearnable();
    const result = await batchUpdateTransactions({
      updated: [{ id: 'dine2', category: 'fast' }],
      learnCategories: true,
      offerCategory: true,
    });
    expect(result.categoryOffer?.uncategorizedIds).toEqual(['uncat']);
    expect(getRules()).toHaveLength(0);
  });

  test('runs the learner as today when there is no offer', async () => {
    await seedLearnable();
    await db.updateTransaction({ id: 'uncat', category: 'fast' });
    // Two simple rules, as when two devices each learned one. The Fast
    // food rule means there is nothing to offer; the learner's
    // observable effect is moving the Dining Out rule to Fast food.
    for (const value of ['fast', 'dining']) {
      await insertRule({
        stage: null,
        conditionsOp: 'and',
        conditions: [{ op: 'is', field: 'payee', value: 'cfa' }],
        actions: [{ op: 'set', field: 'category', value }],
      });
    }
    const result = await batchUpdateTransactions({
      updated: [{ id: 'dine2', category: 'fast' }],
      learnCategories: true,
      offerCategory: true,
    });
    expect(result.categoryOffer).toBeNull();
    expect(getRules().map(rule => rule.serialize().actions[0].value)).toEqual([
      'fast',
      'fast',
    ]);
  });

  test('no offer without learnCategories', async () => {
    await seedLearnable();
    const result = await batchUpdateTransactions({
      updated: [{ id: 'dine2', category: 'fast' }],
      offerCategory: true,
    });
    expect(result.categoryOffer).toBeNull();
  });

  test('no offer for a multi-row update', async () => {
    await seedLearnable();
    const result = await batchUpdateTransactions({
      updated: [
        { id: 'dine2', category: 'fast' },
        { id: 'uncat', category: 'fast' },
      ],
      learnCategories: true,
      offerCategory: true,
    });
    expect(result.categoryOffer).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/core run test src/server/transactions/category-offer.test.ts`
Expected: FAIL, `result.categoryOffer` is undefined.

- [ ] **Step 3: Implement**

In `index.ts`, add `offerCategory = false` to the destructured options and `offerCategory?: boolean` to the type. Import `getCategoryOffer` from `./category-offer`. Replace the `if (learnCategories) { ... }` block with:

```ts
let categoryOffer: CategoryOffer | null = null;
if (learnCategories) {
  const isSingleCategoryEdit =
    offerCategory &&
    !added?.length &&
    !deleted?.length &&
    updated?.length === 1 &&
    Boolean(updated[0].category);
  if (isSingleCategoryEdit) {
    categoryOffer = await getCategoryOffer(updated[0].id);
  }

  // While an offer is open the learner waits for the answer; the
  // client calls category-offer-learn if the offer goes unanswered
  if (!categoryOffer) {
    const ids = new Set([
      ...(added ? added.filter(add => add.category).map(add => add.id) : []),
      ...(updated
        ? updated.filter(update => update.category).map(update => update.id)
        : []),
    ]);
    await rules.updateCategoryRules(
      allAdded.concat(allUpdated).filter(trans => ids.has(trans.id)),
    );
  }
}
```

Add `categoryOffer` to the returned object. In `app.ts`, add `offerCategory` to `handleBatchUpdateTransactions`'s destructuring and pass it to `batchUpdateTransactions`.

- [ ] **Step 4: Run the whole loot-core suite**

Run: `yarn workspace @actual-app/core run test`
Expected: PASS, including the existing `transaction-rules.test.ts` and `index.test.ts` (default `offerCategory = false` leaves them unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/loot-core/src/server/transactions/index.ts packages/loot-core/src/server/transactions/app.ts packages/loot-core/src/server/transactions/category-offer.test.ts
git commit -m "[AI] Return the category offer from the batch update and defer learning"
```

---

### Task 4: A gap after one row in the virtualized table

**Files:**

- Modify: `packages/desktop-client/src/components/FixedSizeList.tsx:240-330, 365-390`
- Modify: `packages/desktop-client/src/components/table.tsx:925-960, 1195-1225`
- Create: `packages/desktop-client/src/components/FixedSizeList.test.tsx`

**Interfaces:**

- Produces: `FixedSizeList` prop `gap?: { afterIndex: number; size: number; content: ReactNode }`. `Table` prop `gap?: { afterId: T['id']; size: number; content: ReactNode }`. When `afterId` is no longer in `items`, the gap stays at the last index it occupied, clamped to the list.

- [ ] **Step 1: Write the failing tests**

`packages/desktop-client/src/components/FixedSizeList.test.tsx`:

```tsx
import { createRef } from 'react';

import { render } from '@testing-library/react';

import { FixedSizeList } from './FixedSizeList';

type Gap = { afterIndex: number; size: number };

function renderList(gap?: Gap) {
  const ref = createRef<FixedSizeList>();
  const tops: Record<number, number> = {};
  const list = (g?: Gap) => (
    <FixedSizeList
      ref={ref}
      width={500}
      height={300}
      itemCount={50}
      itemSize={31}
      renderRow={({ index, style, key }) => {
        tops[index] = style.top;
        return <div key={key} data-index={index} />;
      }}
      gap={g && { ...g, content: <div data-testid="gap" /> }}
    />
  );
  const { rerender } = render(list(gap));
  return {
    list: ref.current!,
    tops,
    setGap: (g?: Gap) => rerender(list(g)),
  };
}

describe('FixedSizeList gap', () => {
  test('rows after the gap move down by its size', () => {
    const { tops } = renderList({ afterIndex: 2, size: 64 });
    expect(tops[2]).toBe(62);
    expect(tops[3]).toBe(3 * 31 + 64);
  });

  test('total size, start index and scroll offsets account for the gap', () => {
    const { list } = renderList({ afterIndex: 2, size: 64 });
    expect(list.getEstimatedTotalSize()).toBe(50 * 31 + 64);
    // An offset inside the gap maps to the row after it
    expect(list.getStartIndexForOffset(3 * 31 + 10)).toBe(3);
    expect(list.getStartIndexForOffset(3 * 31 + 64 + 31)).toBe(4);
    expect(list.getOffsetForIndexAndAlignment(10, 'start', 0)).toBe(
      10 * 31 + 64,
    );
  });

  test('rows already rendered move when the gap opens, resizes and closes', () => {
    // The list caches each row's style; the gap must be part of its key
    const { tops, setGap } = renderList();
    expect(tops[3]).toBe(93);
    setGap({ afterIndex: 2, size: 64 });
    expect(tops[3]).toBe(3 * 31 + 64);
    setGap({ afterIndex: 2, size: 80 });
    expect(tops[3]).toBe(3 * 31 + 80);
    setGap(undefined);
    expect(tops[3]).toBe(93);
  });

  test('without a gap nothing changes', () => {
    const { list, tops } = renderList();
    expect(tops[3]).toBe(93);
    expect(list.getEstimatedTotalSize()).toBe(50 * 31);
  });
});
```

For the Table fallback, add to the same file a `Table` test: render `Table` with items `[{id:'a'},{id:'b'},{id:'c'}]`, `gap={{ afterId: 'b', size: 40, content: <div data-testid="gap" /> }}`, then rerender with items `[{id:'a'},{id:'c'}]` and the same gap; expect `screen.getByTestId('gap')` still rendered. `Table` needs a sized container; wrap in a `div` with `style={{ height: 300, width: 500 }}` and mock `AutoSizer` the way existing table tests do (search `vi.mock` for `AutoSizer` in `desktop-client/src` and copy it; if none exists, mock `react-virtualized-auto-sizer` to call `renderProp({ width: 500, height: 300 })`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/web run test src/components/FixedSizeList.test.tsx`
Expected: FAIL, `tops[3]` is 93, not 157.

- [ ] **Step 3: Implement the gap in `FixedSizeList`**

Add `gap?: { afterIndex: number; size: number; content: ReactNode }` to `FixedSizeListProps`. Replace the offset helpers and route all position math through them:

```ts
getGapStart = () =>
  this.props.gap
    ? (this.props.gap.afterIndex + 1) * this.props.itemSize
    : Infinity;
getGapSize = () => this.props.gap?.size ?? 0;

getItemOffset = (index: number) =>
  index * this.props.itemSize +
  (this.props.gap && index > this.props.gap.afterIndex ? this.getGapSize() : 0);
getItemSize = () => this.props.itemSize;
getEstimatedTotalSize = () =>
  this.props.itemSize * this.props.itemCount + this.getGapSize();
```

In `getOffsetForIndexAndAlignment`, use `this.getEstimatedTotalSize() - size` for `lastItemOffset` and `this.getItemOffset(index)` wherever it computes `index * this.props.itemSize`:

```ts
const lastItemOffset = Math.max(0, this.getEstimatedTotalSize() - size);
const itemOffset = this.getItemOffset(index);
const maxOffset = Math.min(lastItemOffset, itemOffset);
const minOffset = Math.max(0, itemOffset - size + this.props.itemSize);
```

`getStartIndexForOffset`:

```ts
getStartIndexForOffset = (offset: number) => {
  const gapStart = this.getGapStart();
  const gapSize = this.getGapSize();
  const adjusted =
    offset >= gapStart + gapSize
      ? offset - gapSize
      : offset >= gapStart
        ? gapStart
        : offset;
  return Math.max(
    0,
    Math.min(
      this.props.itemCount - 1,
      Math.floor(adjusted / this.props.itemSize),
    ),
  );
};
```

In `getStopIndexForStartIndex`, replace `startIndex * this.props.itemSize` with `this.getItemOffset(startIndex)`. It may render one or two extra rows when the gap is on screen, which is harmless.

`_getItemStyle` caches each row's style in `_getItemStyleCache`, a `memoizeOne` keyed on `(itemSize, layout, direction)`. Add the gap to the key so a gap that opens, resizes or closes after rows have rendered repositions them:

```ts
const itemStyleCache = this._getItemStyleCache(
  itemSize,
  layout,
  direction,
  this.props.gap?.afterIndex ?? -1,
  this.getGapSize(),
);
```

and widen the memoized function to five ignored parameters: `_getItemStyleCache = memoizeOne((_, __, ___, ____, _____) => ({}));`. Update the call near the end of the class that clears the cache (`this._getItemStyleCache(-1, null)`) to pass five arguments too.

In `render()`, after `{items}` inside the inner `div`:

```tsx
{
  this.props.gap && (
    <div
      key="__gap"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top:
          this.getItemOffset(this.props.gap.afterIndex) + this.props.itemSize,
        height: this.props.gap.size,
        zIndex: 102,
      }}
    >
      {this.props.gap.content}
    </div>
  );
}
```

`zIndex: 102` sits above an editing row (101) so the category dropdown of the edited row, which portals elsewhere, is unaffected while the strip is not covered by the row's focus ring. Rows below the gap shift through the list's existing reorder animation when it opens; that is the table's current motion and is kept.

- [ ] **Step 4: Implement the gap in `Table`**

Add `gap?: { afterId: T['id']; size: number; content: ReactNode }` to `TableProps` and destructure it. Before the `return`:

```tsx
const foundGapIndex = gap
  ? items.findIndex(item => item.id === gap.afterId)
  : -1;
const [lastGapIndex, setLastGapIndex] = useState(-1);
useEffect(() => {
  if (foundGapIndex !== -1) {
    setLastGapIndex(foundGapIndex);
  }
}, [foundGapIndex]);
const gapIndex =
  foundGapIndex !== -1
    ? foundGapIndex
    : Math.min(lastGapIndex, items.length - 1);
```

Place these hooks above the early `if (loading) return` so hook order is stable. Pass to `FixedSizeList`:

```tsx
                      gap={
                        gap && gapIndex !== -1
                          ? { afterIndex: gapIndex, size: gap.size, content: gap.content }
                          : undefined
                      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @actual-app/web run test src/components/FixedSizeList.test.tsx src/components/transactions/TransactionsTable.test.tsx`
Expected: PASS; the existing table tests are unaffected with no gap.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-client/src/components/FixedSizeList.tsx packages/desktop-client/src/components/FixedSizeList.test.tsx packages/desktop-client/src/components/table.tsx
git commit -m "[AI] Let the virtualized table open a gap after one row"
```

---

### Task 5: The strip, confirmation and review panel

**Files:**

- Create: `packages/desktop-client/src/components/transactions/CategoryOfferStrip.tsx`
- Test: `packages/desktop-client/src/components/transactions/CategoryOfferStrip.test.tsx`

**Interfaces:**

- Consumes: `CategoryOffer`, `CategoryOfferResult`, `CategoryOfferReviewRow` (Task 1); `CategoryOfferState` (defined here, reused by Task 6).
- Produces:

```ts
export type CategoryOfferState =
  | {
      status: 'offer';
      key: number;
      offer: CategoryOffer;
      previousCategoryId: string | null;
      include: boolean;
    }
  | {
      status: 'applied';
      key: number;
      offer: CategoryOffer;
      result: CategoryOfferResult;
    };

export type CategoryOfferStripProps = {
  state: CategoryOfferState;
  payeeName: string;
  getCategoryName: (id: string) => string;
  getAccountName: (id: string) => string;
  autoFocus: boolean;
  onToggleInclude: () => void;
  onApply: (onlyIds?: string[]) => void;
  onDecline: () => void;
  onUndo: () => void;
  onViewRule: () => void;
  onDismiss: () => void;
  loadReviewRows: () => Promise<CategoryOfferReviewRow[]>;
  onHeightChange: (height: number) => void;
};

export function CategoryOfferStrip(
  props: CategoryOfferStripProps,
): ReactElement;
export function getCategoryOfferAnnouncement(
  state: CategoryOfferState,
  names: { payee: string; category: (id: string) => string },
  t: TFunction,
): string;
```

- [ ] **Step 1: Write the failing tests**

`CategoryOfferStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestProviders } from '#mocks';

import { CategoryOfferStrip } from './CategoryOfferStrip';
import type { CategoryOfferState } from './CategoryOfferStrip';

const offer = {
  transactionId: 'edited',
  payeeId: 'cfa',
  categoryId: 'fast',
  uncategorizedIds: ['uncat'],
  categorizedCount: 10,
  categorizedCategoryId: 'dining',
  replacesRuleCategoryId: null,
  hasSpecificRule: false,
};
const names: Record<string, string> = {
  fast: 'Fast food',
  dining: 'Dining Out',
};

function renderStrip(state: CategoryOfferState, overrides = {}) {
  const props = {
    state,
    payeeName: 'Chick-fil-A',
    getCategoryName: (id: string) => names[id],
    getAccountName: () => 'Checking',
    autoFocus: false,
    onToggleInclude: vi.fn(),
    onApply: vi.fn(),
    onDecline: vi.fn(),
    onUndo: vi.fn(),
    onViewRule: vi.fn(),
    onDismiss: vi.fn(),
    loadReviewRows: vi.fn(async () => [
      {
        id: 'uncat',
        date: '2026-04-04',
        amount: -1200,
        account: 'checking',
        category: null,
      },
      {
        id: 'dine1',
        date: '2026-06-01',
        amount: -1200,
        account: 'checking',
        category: 'dining',
      },
    ]),
    onHeightChange: vi.fn(),
    ...overrides,
  };
  // Stands in for the table's navigator, which must not see strip keys
  const outerKeyDown = vi.fn();
  render(
    <TestProviders>
      <div onKeyDown={outerKeyDown}>
        <CategoryOfferStrip {...props} />
      </div>
    </TestProviders>,
  );
  return { ...props, outerKeyDown };
}

const offerState: CategoryOfferState = {
  status: 'offer',
  key: 1,
  offer,
  previousCategoryId: null,
  include: false,
};

test('states the offer and the rule', () => {
  renderStrip(offerState);
  expect(
    screen.getByText(
      'Also set 1 other uncategorized Chick-fil-A transaction to Fast food, and save a rule to use Fast food for Chick-fil-A from now on?',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: 'Include 10 marked Dining Out' }),
  ).not.toBeChecked();
});

test('rule-only copy when nothing is uncategorized', () => {
  renderStrip({
    ...offerState,
    offer: {
      ...offer,
      uncategorizedIds: [],
      categorizedCount: 0,
      categorizedCategoryId: null,
    },
  });
  expect(
    screen.getByText(
      'Save a rule to use Fast food for Chick-fil-A from now on?',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('names the rule it replaces and a more specific rule', () => {
  renderStrip({
    ...offerState,
    offer: {
      ...offer,
      replacesRuleCategoryId: 'dining',
      hasSpecificRule: true,
    },
  });
  expect(
    screen.getByText(
      'This replaces the rule that sets Chick-fil-A to Dining Out.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'A more specific rule for Chick-fil-A can still set a different category.',
    ),
  ).toBeInTheDocument();
});

test('Apply, Just this one and Escape', async () => {
  const props = renderStrip(offerState, { autoFocus: true });
  expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(props.onApply).toHaveBeenCalledWith(undefined);
  await userEvent.click(screen.getByRole('button', { name: 'Just this one' }));
  expect(props.onDecline).toHaveBeenCalledTimes(1);
  screen.getByRole('button', { name: 'Apply' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(props.onDecline).toHaveBeenCalledTimes(2);
});

test('with include on, Apply becomes a review of every row, all ticked', async () => {
  const props = renderStrip({ ...offerState, include: true });
  await userEvent.click(
    screen.getByRole('button', { name: 'Review 11 changes' }),
  );
  const boxes = await screen.findAllByRole('checkbox', { name: /Checking/ });
  expect(boxes).toHaveLength(2);
  await userEvent.click(boxes[1]);
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply 1 change and save rule' }),
  );
  expect(props.onApply).toHaveBeenCalledWith(['uncat']);
});

test('confirmation offers Undo, View rule and Dismiss', async () => {
  const props = renderStrip({
    status: 'applied',
    key: 1,
    offer,
    result: {
      changedCount: 1,
      ruleId: 'r1',
      restore: { transactions: [], createdRuleId: 'r1', updatedRules: [] },
    },
  });
  expect(
    screen.getByText(
      'Updated 1 transaction and saved a rule: Chick-fil-A → Fast food.',
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await userEvent.click(screen.getByRole('button', { name: 'View rule' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(props.onUndo).toHaveBeenCalled();
  expect(props.onViewRule).toHaveBeenCalled();
  expect(props.onDismiss).toHaveBeenCalled();
});

test('keys pressed in the strip do not reach the table', async () => {
  const props = renderStrip(offerState, { autoFocus: true });
  await userEvent.keyboard('{Tab}');
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard('{ArrowDown}');
  expect(props.outerKeyDown).not.toHaveBeenCalled();
});
```

Check the `#mocks` import path for `TestProviders` against `TransactionsTable.test.tsx` and use the same one. Write both plural forms of the review button, `_one` ("Apply {{count}} change and save rule") and `_other` ("Apply {{count}} changes and save rule"); the same applies to every counted string in the Global Constraints copy.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/web run test src/components/transactions/CategoryOfferStrip.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the strip**

`CategoryOfferStrip.tsx`. Structure: a root `View` with `ref` (for the popover anchor and `ResizeObserver`), `role="region"`, `aria-label={t('Category offer')}`, `onKeyDown` that stops propagation for every key and treats Escape as decline (offer) or dismiss (applied). Style: `backgroundColor: theme.noticeBackgroundLight`, `borderTop` and `borderBottom` `1px solid ${theme.noticeBorder}`, `padding: '10px 12px'`, `flexDirection: 'row'`, `flexWrap: 'wrap'`, `gap: '6px 16px'`, `alignItems: 'center'`, `lineHeight: 1.45`, `color: theme.pageText`. Text column `flex: '1 1 360px'`.

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Button } from '@actual-app/components/button';
import { Popover } from '@actual-app/components/popover';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  CategoryOffer,
  CategoryOfferResult,
  CategoryOfferReviewRow,
} from '@actual-app/core/types/models';

import { Checkbox } from '#components/forms';
import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';

export type CategoryOfferState = /* as in Interfaces */;
export type CategoryOfferStripProps = /* as in Interfaces */;

export function getCategoryOfferAnnouncement(
  state: CategoryOfferState,
  names: { payee: string; category: (id: string) => string },
  t: TFunction,
) {
  const payee = names.payee;
  const category = names.category(state.offer.categoryId);
  if (state.status === 'applied') {
    return state.result.changedCount > 0
      ? t(
          'Updated {{count}} transaction and saved a rule: {{payee}} → {{category}}.',
          { count: state.result.changedCount, payee, category },
        )
      : t('Saved a rule: {{payee}} → {{category}}.', { payee, category });
  }
  const count = state.offer.uncategorizedIds.length;
  return count > 0
    ? t(
        'Also set {{count}} other uncategorized {{payee}} transaction to {{category}}, and save a rule to use {{category}} for {{payee}} from now on?',
        { count, payee, category },
      )
    : t('Save a rule to use {{category}} for {{payee}} from now on?', {
        payee,
        category,
      });
}

export function CategoryOfferStrip({
  state,
  payeeName,
  getCategoryName,
  getAccountName,
  autoFocus,
  onToggleInclude,
  onApply,
  onDecline,
  onUndo,
  onViewRule,
  onDismiss,
  loadReviewRows,
  onHeightChange,
}: CategoryOfferStripProps): ReactElement {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const [reviewRows, setReviewRows] = useState<CategoryOfferReviewRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => onHeightChange(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  useEffect(() => {
    if (autoFocus) applyRef.current?.focus();
  }, [autoFocus, state.key]);

  const { offer } = state;
  const sentence = getCategoryOfferAnnouncement(
    state,
    { payee: payeeName, category: getCategoryName },
    t,
  );
  const reviewCount = offer.uncategorizedIds.length + offer.categorizedCount;

  async function openReview() {
    const rows = await loadReviewRows();
    setTicked(new Set(rows.map(row => row.id)));
    setReviewRows(rows);
  }

  // ...render: sentence; replace/specific notes; include checkbox
  // (label "Include {{count}} marked {{category}}" when
  // offer.categorizedCategoryId, else "Include {{count}} with other
  // categories", shown only when offer.categorizedCount > 0);
  // actions: Apply (variant="primary", ref=applyRef) calling
  // onApply(undefined), or "Review {{count}} changes" calling
  // openReview when state.include; "Just this one" (variant="bare")
  // calling onDecline. Applied state: sentence, Undo (normal), View
  // rule (variant="bare"), Dismiss (variant="bare").
  // Review: <Popover triggerRef={rootRef} isOpen={reviewRows !== null}
  // onOpenChange={open => !open && setReviewRows(null)}
  // placement="bottom end" style={{ width: 360, maxHeight: 320,
  // overflow: 'auto' }}> listing each row as a Checkbox labelled
  // "{date} · {account} · {category or 'Uncategorized'} · {amount}"
  // with FinancialText for the amount, then "Apply {{count}} changes
  // and save rule" (primary, disabled when nothing is ticked) calling
  // onApply([...ticked]) and Cancel closing the popover.
}
```

Write the render body in full following those comments. Use `<Trans>` for static labels in JSX and `t()` only for strings that also feed the live region or take a count, which is the repo's existing split. Check the exact import paths for `Button`, `Popover`, `View`, `Checkbox`, `FinancialText` and the amount formatter against a nearby file such as `TransactionsTable.tsx`, and use those.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @actual-app/web run test src/components/transactions/CategoryOfferStrip.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop-client/src/components/transactions/CategoryOfferStrip.tsx packages/desktop-client/src/components/transactions/CategoryOfferStrip.test.tsx
git commit -m "[AI] Add the category offer strip, confirmation and review panel"
```

---

### Task 6: Offer state, wiring, focus and highlight

**Files:**

- Create: `packages/desktop-client/src/components/transactions/useCategoryOffer.ts`
- Create: `packages/desktop-client/src/components/transactions/useCategoryOffer.test.tsx`
- Modify: `packages/desktop-client/src/components/transactions/TransactionList.tsx:62-83, 190-222, 516-565`
- Modify: `packages/desktop-client/src/components/transactions/TransactionsTable.tsx` (`TransactionTableProps`, `TransactionTableInner`, `renderRow`, `Transaction` row background)
- Test: `packages/desktop-client/src/components/transactions/TransactionsTable.test.tsx`

**Interfaces:**

- Consumes: handlers from Task 2, `categoryOffer` from Task 3, `Table` `gap` from Task 4, `CategoryOfferStrip` and `CategoryOfferState` from Task 5.
- Produces:

```ts
export type CategoryOfferController = {
  state: CategoryOfferState | null;
  highlightedIds: ReadonlySet<string>;
  /** Call at the start of every save. Closes an open offer as unanswered
   * (running the learner for it) and returns this save's sequence number. */
  beginSave: () => number;
  /** Shows the offer if `saveSeq` is still the latest save; otherwise runs
   * the learner for it. Also learns for any open offer it replaces. */
  show: (
    offer: CategoryOffer,
    previousCategoryId: string | null,
    saveSeq: number,
  ) => void;
  toggleInclude: () => void;
  apply: (onlyIds?: string[]) => Promise<void>;
  decline: () => void;
  undo: () => Promise<void>;
  dismiss: () => void;
  loadReviewRows: () => Promise<CategoryOfferReviewRow[]>;
};

export function useCategoryOffer(options: {
  onRefetch: () => void;
}): CategoryOfferController;
```

`TransactionTableProps` gains `categoryOffer?: CategoryOfferController` and `onViewRule?: (ruleId: string) => void`.

- [ ] **Step 1: Write the failing hook tests**

`useCategoryOffer.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';

import { initServer } from '@actual-app/core/platform/client/connection';

import { useCategoryOffer } from './useCategoryOffer';

const offer = {
  transactionId: 'edited',
  payeeId: 'cfa',
  categoryId: 'fast',
  uncategorizedIds: ['uncat'],
  categorizedCount: 0,
  categorizedCategoryId: null,
  replacesRuleCategoryId: null,
  hasSpecificRule: false,
};
const result = {
  changedCount: 1,
  ruleId: 'r1',
  restore: { transactions: [], createdRuleId: 'r1', updatedRules: [] },
};

let calls: Array<[string, unknown]>;
beforeEach(() => {
  calls = [];
  const record =
    (name: string, value: unknown = undefined) =>
    async (args: unknown) => {
      calls.push([name, args]);
      return value;
    };
  initServer({
    'category-offer-apply': record('apply', result),
    'category-offer-undo': record('undo'),
    'category-offer-learn': record('learn'),
    'category-offer-review-rows': record('rows', []),
  });
});
afterEach(() => global.__resetWorld());

function setup() {
  const onRefetch = vi.fn();
  const hook = renderHook(() => useCategoryOffer({ onRefetch }));
  // A save whose response carries an offer, with nothing saved since
  const open = (o = offer, previous: string | null = null) =>
    act(() => {
      const seq = hook.result.current.beginSave();
      hook.result.current.show(o, previous, seq);
    });
  return { hook, onRefetch, open };
}

test('an unanswered offer runs the learner once when the next save closes it', async () => {
  const { hook, open } = setup();
  open();
  act(() => void hook.result.current.beginSave());
  act(() => void hook.result.current.beginSave());
  await act(async () => {});
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
  expect(hook.result.current.state).toBeNull();
});

test('a response from an older save learns instead of showing', async () => {
  // Row A is saved, then row B is saved before A's response arrives
  const { hook } = setup();
  let seqA = 0;
  let seqB = 0;
  act(() => {
    seqA = hook.result.current.beginSave();
    seqB = hook.result.current.beginSave();
  });
  act(() => hook.result.current.show(offer, null, seqA));
  await act(async () => {});
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
  expect(hook.result.current.state).toBeNull();
  act(() =>
    hook.result.current.show({ ...offer, transactionId: 'b' }, null, seqB),
  );
  expect(hook.result.current.state?.offer.transactionId).toBe('b');
});

test('an offer that replaces an open one learns for the old edit', async () => {
  const { hook } = setup();
  let seq = 0;
  act(() => {
    seq = hook.result.current.beginSave();
  });
  act(() => hook.result.current.show(offer, null, seq));
  act(() =>
    hook.result.current.show({ ...offer, transactionId: 'other' }, null, seq),
  );
  await act(async () => {});
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
  expect(hook.result.current.state?.offer.transactionId).toBe('other');
});

test('declining learns nothing', async () => {
  const { hook, open } = setup();
  open();
  act(() => hook.result.current.decline());
  act(() => void hook.result.current.beginSave());
  await act(async () => {});
  expect(calls).toEqual([]);
});

test('apply sends the edit context, highlights and refetches; undo restores', async () => {
  const { hook, onRefetch, open } = setup();
  open(offer, 'dining');
  await act(() => hook.result.current.apply());
  expect(calls[0]).toEqual([
    'apply',
    {
      transactionId: 'edited',
      categoryId: 'fast',
      previousCategoryId: 'dining',
      onlyIds: undefined,
    },
  ]);
  expect(hook.result.current.state?.status).toBe('applied');
  expect([...hook.result.current.highlightedIds]).toEqual(['uncat']);
  expect(onRefetch).toHaveBeenCalledTimes(1);
  await act(() => hook.result.current.undo());
  expect(calls[1]).toEqual(['undo', { restore: result.restore }]);
  expect(hook.result.current.state).toBeNull();
  expect(onRefetch).toHaveBeenCalledTimes(2);
});

test('unmounting with an open offer runs the learner', async () => {
  const { hook, open } = setup();
  open();
  hook.unmount();
  await act(async () => {});
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
});
```

The global-undo case (Review Focus 5) is tested by emitting an `undo-event` after `open()`, then asserting the state is `null` and the calls are exactly `[['learn', { transactionId: 'edited' }]]`. Check how other tests trigger `listen` handlers (search `desktop-client/src` tests for `'undo-event'`). If there is no existing way to emit a server event in tests, have the hook's listener call an exported `closeOnUndo(controllerInternals)` helper and test that helper directly; the behavior under test is "learns for an open offer, then clears".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @actual-app/web run test src/components/transactions/useCategoryOffer.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the hook**

`useCategoryOffer.ts`:

```ts
import { useEffect, useRef, useState } from 'react';

import { listen, send } from '@actual-app/core/platform/client/connection';
import type {
  CategoryOffer,
  CategoryOfferReviewRow,
} from '@actual-app/core/types/models';

import type { CategoryOfferState } from './CategoryOfferStrip';

const HIGHLIGHT_MS = 1500;

export type CategoryOfferController = {/* as in Interfaces */};

export function useCategoryOffer({
  onRefetch,
}: {
  onRefetch: () => void;
}): CategoryOfferController {
  const [state, setState] = useState<CategoryOfferState | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Read by beginSave, show and the unmount cleanup, which can run
  // before a re-render has delivered the latest state
  const stateRef = useRef<CategoryOfferState | null>(null);
  const nextKey = useRef(0);
  // Saves do not wait for the server, so a response can arrive after a
  // later save has started; only the latest save may show an offer
  const latestSave = useRef(0);

  function update(next: CategoryOfferState | null) {
    stateRef.current = next;
    setState(next);
  }

  function learn(offer: CategoryOffer) {
    void send('category-offer-learn', { transactionId: offer.transactionId });
  }

  function learnIfOpen() {
    const current = stateRef.current;
    if (current?.status === 'offer') {
      learn(current.offer);
    }
  }

  useEffect(() => {
    // A global undo means Apply is no longer the latest change. An open
    // offer goes unanswered; the learner reads current data, so running
    // it after the edit itself was undone is harmless.
    return listen('undo-event', () => {
      learnIfOpen();
      update(null);
    });
  }, []);

  useEffect(() => {
    if (highlightedIds.size === 0) return;
    const id = setTimeout(() => setHighlightedIds(new Set()), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [highlightedIds]);

  useEffect(() => () => learnIfOpen(), []);

  return {
    state,
    highlightedIds,
    beginSave() {
      learnIfOpen();
      update(null);
      return ++latestSave.current;
    },
    show(offer, previousCategoryId, saveSeq) {
      if (saveSeq !== latestSave.current) {
        learn(offer);
        return;
      }
      learnIfOpen();
      update({
        status: 'offer',
        key: ++nextKey.current,
        offer,
        previousCategoryId,
        include: false,
      });
    },
    toggleInclude() {
      const current = stateRef.current;
      if (current?.status === 'offer') {
        update({ ...current, include: !current.include });
      }
    },
    async apply(onlyIds) {
      const current = stateRef.current;
      if (current?.status !== 'offer') return;
      const result = await send('category-offer-apply', {
        transactionId: current.offer.transactionId,
        categoryId: current.offer.categoryId,
        previousCategoryId: current.previousCategoryId,
        onlyIds,
      });
      update({
        status: 'applied',
        key: current.key,
        offer: current.offer,
        result,
      });
      setHighlightedIds(new Set(onlyIds ?? current.offer.uncategorizedIds));
      onRefetch();
    },
    decline() {
      update(null);
    },
    async undo() {
      const current = stateRef.current;
      if (current?.status !== 'applied') return;
      update(null);
      await send('category-offer-undo', { restore: current.result.restore });
      onRefetch();
    },
    dismiss() {
      update(null);
    },
    loadReviewRows() {
      const current = stateRef.current;
      if (!current) return Promise.resolve([]);
      return send('category-offer-review-rows', {
        transactionId: current.offer.transactionId,
        categoryId: current.offer.categoryId,
      });
    },
  };
}
```

If the linter flags the empty-deps unmount effect or the listen effect, keep them (they are intentionally mount-only) and add the repo's usual disable comment with a reason, matching how other mount-only effects in `desktop-client` are written.

- [ ] **Step 4: Run the hook tests to verify they pass**

Run: `yarn workspace @actual-app/web run test src/components/transactions/useCategoryOffer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing table tests**

In `TransactionsTable.test.tsx`, make `LiveTransactionTable` accept and forward `categoryOffer` and `onViewRule` (it spreads its props into `TransactionTable`; confirm and add the prop types if not). Add:

```tsx
function fakeController(
  state: CategoryOfferState | null,
): CategoryOfferController {
  return {
    state,
    highlightedIds: new Set(),
    show: vi.fn(),
    beginSave: vi.fn(() => 0),
    toggleInclude: vi.fn(),
    apply: vi.fn(async () => {}),
    decline: vi.fn(),
    undo: vi.fn(async () => {}),
    dismiss: vi.fn(),
    loadReviewRows: vi.fn(async () => []),
  };
}

function offerFor(transactionId: string): CategoryOfferState {
  return {
    status: 'offer',
    key: 1,
    previousCategoryId: null,
    include: false,
    offer: {
      transactionId,
      payeeId: payees[0].id,
      categoryId: categories[0].id,
      uncategorizedIds: ['x'],
      categorizedCount: 0,
      categorizedCategoryId: null,
      replacesRuleCategoryId: null,
      hasSpecificRule: false,
    },
  };
}

test('after an Enter save, focus moves to Apply and Escape returns it', async () => {
  const { container, getTransactions, updateProps } = renderTransactions({
    categoryOffer: fakeController(null),
  });
  const input = await editField(container, 'notes', 2);
  await userEvent.type(input, '[Enter]');
  expectToBeEditingField(container, 'notes', 3);

  const controller = fakeController(offerFor(getTransactions()[2].id));
  updateProps({ categoryOffer: controller });
  expect(await screen.findByRole('button', { name: 'Apply' })).toHaveFocus();
  expect(container.querySelector('input')).toBe(null);

  await userEvent.keyboard('{Escape}');
  expect(controller.decline).toHaveBeenCalled();
  expectToBeEditingField(container, 'notes', 3);
});

test('focus stays put when the person is editing a distant row', async () => {
  const { container, getTransactions, updateProps } = renderTransactions({
    categoryOffer: fakeController(null),
  });
  await editField(container, 'notes', 0);
  updateProps({
    categoryOffer: fakeController(offerFor(getTransactions()[3].id)),
  });
  await screen.findByRole('button', { name: 'Apply' });
  expectToBeEditingField(container, 'notes', 0);
});

test('a mouse edit leaves focus where it was', async () => {
  const { container, getTransactions, updateProps } = renderTransactions({
    categoryOffer: fakeController(null),
  });
  await editField(container, 'notes', 2);
  updateProps({
    categoryOffer: fakeController(offerFor(getTransactions()[2].id)),
  });
  await screen.findByRole('button', { name: 'Apply' });
  expectToBeEditingField(container, 'notes', 2);
});

test('the offer sentence is announced politely', async () => {
  const { getTransactions, updateProps } = renderTransactions({
    categoryOffer: fakeController(null),
  });
  updateProps({
    categoryOffer: fakeController(offerFor(getTransactions()[2].id)),
  });
  const region = document.querySelector('[aria-live="polite"]');
  expect(region?.textContent).toMatch(/save a rule/);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
```

- [ ] **Step 6: Run the table tests to verify they fail**

Run: `yarn workspace @actual-app/web run test src/components/transactions/TransactionsTable.test.tsx`
Expected: the four new tests FAIL (no Apply button rendered).

- [ ] **Step 7: Implement the table side**

In `TransactionTableProps` add:

```ts
  categoryOffer?: CategoryOfferController;
  onViewRule?: (ruleId: string) => void;
```

They reach `TransactionTableInner` through its existing `{...props}` spread; add the same two fields to `TransactionTableInnerProps`.

In `TransactionTableInner`:

```tsx
const offerState = props.categoryOffer?.state ?? null;
const [stripHeight, setStripHeight] = useState(64);
const [returnTarget, setReturnTarget] = useState<{
  id: TransactionEntity['id'];
  field: string;
} | null>(null);
const [autoFocusStrip, setAutoFocusStrip] = useState(false);

// When an offer arrives after an Enter save, the navigator has already
// moved to the adjacent row. Take focus for the strip and remember
// where the table was going so answering can return there.
const offerKey = offerState?.status === 'offer' ? offerState.key : null;
useEffect(() => {
  if (offerKey === null || !offerState) return;
  const anchorIndex = transactionsToRender.findIndex(
    t => t.id === offerState.offer.transactionId,
  );
  const editingIndex = transactionsToRender.findIndex(
    t => t.id === tableNavigator.editingId,
  );
  const movedByKeyboard =
    editingIndex !== -1 &&
    anchorIndex !== -1 &&
    Math.abs(editingIndex - anchorIndex) === 1;
  if (movedByKeyboard) {
    setReturnTarget({
      id: tableNavigator.editingId,
      field: tableNavigator.focusedField,
    });
    tableNavigator.onEdit(null);
    setAutoFocusStrip(true);
  } else {
    setReturnTarget(null);
    setAutoFocusStrip(false);
  }
  // Runs once per offer
}, [offerKey]);

function returnFocus() {
  if (returnTarget) {
    tableNavigator.onEdit(returnTarget.id, returnTarget.field);
    setReturnTarget(null);
  }
  setAutoFocusStrip(false);
}

const categoriesById = getCategoriesById(props.categoryGroups);
const payeeName =
  offerState &&
  (props.payees.find(p => p.id === offerState.offer.payeeId)?.name ?? '');
const getCategoryName = (id: string) => categoriesById[id]?.name ?? '';
const getAccountName = (id: string) =>
  props.accounts.find(a => a.id === id)?.name ?? '';
const announcement = offerState
  ? getCategoryOfferAnnouncement(
      offerState,
      { payee: payeeName, category: getCategoryName },
      t,
    )
  : '';
```

(`getCategoriesById` is defined at the bottom of this file; use it. Add `const { t } = useTranslation();` if the component does not already have it.)

Pass to `Table`:

```tsx
          gap={
            offerState && props.categoryOffer
              ? {
                  afterId: offerState.offer.transactionId,
                  size: stripHeight,
                  content: (
                    <CategoryOfferStrip
                      state={offerState}
                      payeeName={payeeName}
                      getCategoryName={getCategoryName}
                      getAccountName={getAccountName}
                      autoFocus={autoFocusStrip}
                      onToggleInclude={props.categoryOffer.toggleInclude}
                      onApply={onlyIds => {
                        void props.categoryOffer.apply(onlyIds);
                        returnFocus();
                      }}
                      onDecline={() => {
                        props.categoryOffer.decline();
                        returnFocus();
                      }}
                      onUndo={() => void props.categoryOffer.undo()}
                      onViewRule={() =>
                        offerState.status === 'applied' &&
                        props.onViewRule?.(offerState.result.ruleId)
                      }
                      onDismiss={props.categoryOffer.dismiss}
                      loadReviewRows={props.categoryOffer.loadReviewRows}
                      onHeightChange={setStripHeight}
                    />
                  ),
                }
              : undefined
          }
```

Next to the `Table`, render the persistent polite region (always mounted, so screen readers register it before text arrives):

```tsx
<div
  aria-live="polite"
  style={{
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
  }}
>
  {announcement}
</div>
```

If `desktop-client` or the component library already has a visually-hidden style or component (search for `clip: 'rect(0` or `visuallyHidden`), use that instead.

In `renderRow`, replace `highlighted={false}` with `highlighted={props.categoryOffer?.highlightedIds.has(trans.id) ?? false}`. In the `Transaction` row's `Row` style, change the background condition from `selected ?` to `selected || highlighted ?` and add `transition: 'background-color 0.6s ease-out'`. This is a color transition only.

- [ ] **Step 8: Wire `TransactionList`**

```tsx
const categoryOffer = useCategoryOffer({ onRefetch });
```

Change `saveDiff` and `saveDiffAndApply` to carry the offer out:

```ts
async function saveDiff(diff, learnCategories, offerCategory = false) {
  const remoteUpdates = await send('transactions-batch-update', {
    ...diff,
    learnCategories,
    offerCategory,
  });
  const categoryOffer = remoteUpdates?.categoryOffer ?? null;

  if (remoteUpdates && remoteUpdates.updated.length > 0) {
    return { updates: remoteUpdates, categoryOffer };
  }
  return { categoryOffer };
}

async function saveDiffAndApply(
  diff,
  changes,
  onChange,
  learnCategories,
  offerCategory = false,
) {
  const { categoryOffer, ...remoteDiff } = await saveDiff(
    diff,
    learnCategories,
    offerCategory,
  );
  onChange(
    // @ts-expect-error - fix me
    applyTransactionDiff(changes.newTransaction, remoteDiff),
    // @ts-expect-error - fix me
    applyChanges(remoteDiff, changes.data),
  );
  return categoryOffer;
}
```

In `onSave`, before computing `changes`:

```ts
const saveSeq = categoryOffer.beginSave();
const previousCategoryId =
  transactionsLatest.current.find(t => t.id === transaction.id)?.category ??
  null;
```

and in the non-date branch:

```ts
const updated = changes.diff.updated[0];
const isCategoryEdit =
  changes.diff.updated.length === 1 &&
  changes.diff.added.length === 0 &&
  changes.diff.deleted.length === 0 &&
  'category' in updated &&
  Boolean(updated.category);
void saveDiffAndApply(
  changes.diff,
  changes,
  onChange,
  isLearnCategoriesEnabled,
  isCategoryEdit,
).then(offer => {
  if (offer) {
    categoryOffer.show(offer, previousCategoryId, saveSeq);
  }
});
```

Add `categoryOffer` to `onSave`'s dependency list. Pass to `TransactionTable`:

```tsx
        categoryOffer={categoryOffer}
        onViewRule={async ruleId => {
          const rule = await send('rule-get', { id: ruleId });
          if (rule) {
            dispatch(pushModal({ modal: { name: 'edit-rule', options: { rule } } }));
          }
        }}
```

Check `rule-get`'s argument shape in `packages/loot-core/src/server/rules/app.ts` (`getRule`) and match it.

- [ ] **Step 9: Run the desktop-client tests**

Run: `yarn workspace @actual-app/web run test src/components/transactions src/components/FixedSizeList.test.tsx`
Expected: PASS, including every pre-existing `TransactionsTable.test.tsx` test.

- [ ] **Step 10: Commit**

```bash
git add packages/desktop-client/src/components/transactions/useCategoryOffer.ts packages/desktop-client/src/components/transactions/useCategoryOffer.test.tsx packages/desktop-client/src/components/transactions/TransactionList.tsx packages/desktop-client/src/components/transactions/TransactionsTable.tsx packages/desktop-client/src/components/transactions/TransactionsTable.test.tsx
git commit -m "[AI] Show the category offer under the edited row"
```

---

### Task 7: Release note, checks, and a run in the real app

**Files:**

- Create: `upcoming-release-notes/category-offer.md`
- Modify: i18n output from `yarn generate:i18n` if it changes tracked files

- [ ] **Step 1: Write the release note**

Use the `writing-release-notes` skill. Draft:

```markdown
---
category: Features
authors: [ssebelius]
---

After you categorize a transaction, Actual offers to give the same category to that payee's other uncategorized transactions and to save a rule for future ones.
```

- [ ] **Step 2: Repo checks**

Run from the repo root, in order, and read each output:

```bash
yarn generate:i18n
yarn lint:fix
yarn typecheck
yarn test
```

Expected: all pass. `yarn typecheck` overwrites `packages/api/dist` with an unbundled build; `yarn seed` detects and rebuilds it, so run the seed after typecheck, not before.

- [ ] **Step 3: Run it in the app on the family sample**

```bash
yarn seed --profile family
yarn start
```

Open one tab on http://localhost:3001 (several tabs share one backend and stall). Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1237/chrome-headless-shell-mac-arm64/chrome-headless-shell` if driving it with Playwright. Check, and record what was observed:

1. Set the April 17 Chick-fil-A purchase to Fast food with the mouse. The strip appears under the row with the exact offer copy and "Include 10 marked Dining Out". Focus stays in place.
2. Apply. April 4 turns Fast food and tints briefly; the confirmation reads "Updated 1 transaction and saved a rule: Chick-fil-A → Fast food."; View rule opens the rule editor with "payee is Chick-fil-A → Fast food".
3. Undo. April 17 and April 4 return to uncategorized and the rule is gone from the Rules page.
4. Repeat with Enter: focus lands on Apply; Escape returns to the next row's category cell; no rule is created.
5. Repeat and walk away by editing another row: the strip closes and no offer rule is created (the silent learner may or may not create one, per its 3-of-5 threshold).
6. Include path: tick Include, "Review 11 changes" opens the panel with 11 rows ticked; untick 5; apply; 6 rows change.
7. Uncategorized view: apply there; the confirmation stays in place after the edited row leaves the list.
8. Switch to the dark and midnight themes and check the strip and the highlight tint are legible.
9. Time a category edit on the payee with the most transactions (browser performance panel, from keypress to strip). Record the number in the ledger.

- [ ] **Step 4: Commit**

```bash
git add upcoming-release-notes/category-offer.md
git add -u packages/desktop-client/locale 2>/dev/null
git commit -m "[AI] Add the release note for the category offer"
```

Stage only files this plan created or changed; `git status` will also list `proposals/bank-file-setup/`, which belongs to other work.

---

## Deliberate differences from the spec

- **Seed-based regression checks.** The PRD asks for automated tests on `yarn seed` budgets. The loot-core tests use a small fixture that mirrors the PRD's Chick-fil-A case instead, because loot-core tests cannot depend on the sample-data package without a new cross-package test dependency. The seeded budget is exercised by hand in Task 7.
- **Rule-accuracy measurement** needs the generator hold-out and is not part of this plan.
- **Learner rule and Cmd+Z.** Today Cmd+Z of a category edit also removes a rule the silent learner created from it. When the learner is deferred by an unanswered offer, its rule is saved in a separate, non-undoable step, so Cmd+Z of that edit leaves the rule.
- **Closing the app with an offer open** loses that edit's silent learning, because the unmount cleanup cannot reach the server once the page is gone. Leaving the view within the app does run it.
