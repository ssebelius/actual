import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { clearUndo, undo } from '#server/undo';

import { app } from './app';
import {
  getCategoryOffer,
  getCategoryOfferReviewRows,
  learnFromCategoryEdit,
  OTHER_ROWS_SQL,
} from './category-offer';
import {
  getRules,
  insertRule,
  loadRules,
  resetState,
} from './transaction-rules';

import { batchUpdateTransactions } from './index';

beforeEach(async () => {
  await global.emptyDatabase()();
  resetState();
  await loadMappings();
  await loadRules();
  clearUndo();
});

async function seed() {
  await db.insertAccount({ id: 'checking', name: 'Checking' });
  await db.insertAccount({ id: 'savings', name: 'Savings', offbudget: 1 });
  await db.insertCategoryGroup({ id: 'food', name: 'Food' });
  await db.insertCategory({
    id: 'fast',
    name: 'Fast food',
    cat_group: 'food',
  });
  await db.insertCategory({
    id: 'dining',
    name: 'Dining Out',
    cat_group: 'food',
  });
  await db.insertPayee({ id: 'cfa', name: 'Chick-fil-A' });
  await db.insertPayee({ id: 'solo', name: 'Solo Cafe' });

  const row = (
    id: string,
    date: string,
    category: string | null,
    extra: Record<string, unknown> = {},
  ) =>
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

function simpleRule(value: string) {
  return {
    stage: null,
    conditionsOp: 'and' as const,
    conditions: [{ op: 'is' as const, field: 'payee' as const, value: 'cfa' }],
    actions: [{ op: 'set' as const, field: 'category' as const, value }],
  };
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

  test("no offer on a merchant's first transaction", async () => {
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
    await insertRule(simpleRule('fast'));
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
    await insertRule(simpleRule('dining'));
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
      is_parent: true,
    });
    await db.insertTransaction({
      id: 'child',
      account: 'checking',
      payee: 'cfa',
      date: '2026-05-10',
      amount: -3000,
      category: null,
      is_child: true,
      parent_id: 'parent',
    });
    const offer = await getCategoryOffer('edited');
    expect(offer?.uncategorizedIds.sort()).toEqual(['child', 'uncat']);
  });

  test('the payee lookup uses the description index', async () => {
    await seed();
    const plan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${OTHER_ROWS_SQL}`,
      ['cfa', 'edited'],
    );
    expect(plan.map(row => row.detail).join('\n')).toMatch(/trans_description/);
  });
});

async function categoryOf(id: string) {
  const row = await db.first<{ category: string | null }>(
    'SELECT category FROM v_transactions WHERE id = ?',
    [id],
  );
  return row?.category ?? null;
}

function ruleCategories() {
  return getRules().map(rule => rule.serialize().actions[0].value);
}

const apply = (args: {
  previousCategoryId: string | null;
  onlyIds?: string[];
}) =>
  app.handlers['category-offer-apply']({
    transactionId: 'edited',
    categoryId: 'fast',
    ...args,
  });

describe('category-offer-apply', () => {
  test('changes the uncategorized rows and creates a simple rule', async () => {
    await seed();
    const result = await apply({ previousCategoryId: null });
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
    const result = await apply({
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
    const id = await insertRule(simpleRule('dining'));
    const result = await apply({ previousCategoryId: 'dining' });
    expect(result.ruleId).toBe(id);
    expect(ruleCategories()).toEqual(['fast']);
  });

  test('a global undo reverts Apply as one step', async () => {
    await seed();
    await apply({ previousCategoryId: null });
    await undo();
    expect(await categoryOf('uncat')).toBe(null);
    expect(getRules()).toHaveLength(0);
    // The edit itself happened outside this step and stays
    expect(await categoryOf('edited')).toBe('fast');
  });
});

describe('category-offer-undo', () => {
  test('restores the edited row, the other rows and removes a created rule', async () => {
    await seed();
    const { restore } = await apply({
      previousCategoryId: null,
      onlyIds: ['uncat', 'dine1'],
    });
    await app.handlers['category-offer-undo']({ restore });
    expect(await categoryOf('edited')).toBe(null);
    expect(await categoryOf('uncat')).toBe(null);
    expect(await categoryOf('dine1')).toBe('dining');
    expect(getRules()).toHaveLength(0);
  });

  test('restores a replaced rule to its previous category', async () => {
    await seed();
    await insertRule(simpleRule('dining'));
    const { restore } = await apply({ previousCategoryId: 'dining' });
    await app.handlers['category-offer-undo']({ restore });
    expect(ruleCategories()).toEqual(['dining']);
    expect(await categoryOf('edited')).toBe('dining');
  });
});

test('learnFromCategoryEdit runs the silent learner for one edit', async () => {
  await seed();
  // The learner reads up to 180 days after today, and under test today
  // is always 2017-01-01, so this case needs rows dated near it
  for (const [id, date] of [
    ['old1', '2016-12-01'],
    ['old2', '2016-12-02'],
    ['old3', '2016-12-03'],
  ]) {
    await db.insertTransaction({
      id,
      account: 'checking',
      payee: 'solo',
      date,
      amount: -500,
      category: 'fast',
    });
  }
  await learnFromCategoryEdit({ transactionId: 'old3' });
  expect(getRules().map(rule => rule.serialize())).toMatchObject([
    {
      conditions: [{ op: 'is', field: 'payee', value: 'solo' }],
      actions: [{ op: 'set', field: 'category', value: 'fast' }],
    },
  ]);
});

test('review rows list the rows whose category differs, newest first', async () => {
  await seed();
  const rows = await getCategoryOfferReviewRows({
    transactionId: 'edited',
    categoryId: 'fast',
  });
  expect(rows.map(r => r.id)).toEqual(['dine2', 'dine1', 'uncat']);
  expect(rows[0].date).toBe('2026-07-01');
});

describe('batchUpdateTransactions with offerCategory', () => {
  // Dated near the pinned test "today" (2017-01-01) so the learner can see
  // them. Two are Fast food already; saving s3 as Fast food makes three.
  async function seedLearnable() {
    await seed();
    const row = (id: string, date: string, category: string | null) =>
      db.insertTransaction({
        id,
        account: 'checking',
        payee: 'solo',
        date,
        amount: -500,
        category,
      });
    await row('s1', '2016-12-01', 'fast');
    await row('s2', '2016-12-02', 'fast');
    await row('s3', '2016-12-03', null);
    await row('s4', '2016-11-01', null);
  }

  const saveS3 = (options: { learnCategories?: boolean } = {}) =>
    batchUpdateTransactions({
      updated: [{ id: 's3', category: 'fast' }],
      learnCategories: true,
      offerCategory: true,
      ...options,
    });

  test('learns as today without offerCategory', async () => {
    await seedLearnable();
    await batchUpdateTransactions({
      updated: [{ id: 's3', category: 'fast' }],
      learnCategories: true,
    });
    expect(ruleCategories()).toEqual(['fast']);
  });

  test('returns the offer and does not run the learner', async () => {
    await seedLearnable();
    const result = await saveS3();
    expect(result.categoryOffer?.uncategorizedIds).toEqual(['s4']);
    expect(getRules()).toHaveLength(0);
  });

  test('runs the learner as today when there is no offer', async () => {
    await seedLearnable();
    await db.updateTransaction({ id: 's4', category: 'fast' });
    // Two simple rules, as when two devices each learned one. The Fast
    // food rule means there is nothing to offer; the learner's
    // observable effect is moving the Dining Out rule to Fast food.
    for (const value of ['fast', 'dining']) {
      await insertRule({
        ...simpleRule(value),
        conditions: [{ op: 'is', field: 'payee', value: 'solo' }],
      });
    }
    const result = await saveS3();
    expect(result.categoryOffer).toBeNull();
    expect(ruleCategories()).toEqual(['fast', 'fast']);
  });

  test('no offer without learnCategories', async () => {
    await seedLearnable();
    const result = await saveS3({ learnCategories: false });
    expect(result.categoryOffer).toBeNull();
  });

  test('no offer for a multi-row update', async () => {
    await seedLearnable();
    const result = await batchUpdateTransactions({
      updated: [
        { id: 's3', category: 'fast' },
        { id: 's4', category: 'fast' },
      ],
      learnCategories: true,
      offerCategory: true,
    });
    expect(result.categoryOffer).toBeNull();
  });
});
