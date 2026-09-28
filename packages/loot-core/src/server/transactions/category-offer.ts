import * as db from '#server/db';
import { fromDateRepr } from '#server/models';
import { Rule } from '#server/rules';
import type {
  CategoryOffer,
  CategoryOfferRestore,
  CategoryOfferResult,
  CategoryOfferReviewRow,
  RuleEntity,
  TransactionEntity,
} from '#types/models';

import {
  deleteRule,
  getRules,
  insertRule,
  updateCategoryRules,
  updateRule,
} from './transaction-rules';

import { batchUpdateTransactions } from '.';

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
// which the trans_description index serves.
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
  const payeeId = edited.payee;
  const categoryId = edited.category;

  const others = await getOtherRows(payeeId, transactionId);
  if (others.length === 0) {
    return null;
  }

  const uncategorizedIds = others.filter(t => !t.category).map(t => t.id);
  const categorized = others.filter(
    t => t.category && t.category !== categoryId,
  );
  const categorizedCategories = new Set(categorized.map(t => t.category));

  const simpleRules = getSimpleCategoryRules(payeeId);
  const hasSameRule = simpleRules.some(
    rule => rule.actions[0].value === categoryId,
  );
  if (uncategorizedIds.length === 0 && hasSameRule) {
    return null;
  }
  const replaced = simpleRules.find(
    rule => rule.actions[0].value !== categoryId,
  );

  return {
    transactionId,
    payeeId,
    categoryId,
    uncategorizedIds,
    categorizedCount: categorized.length,
    categorizedCategoryId:
      categorizedCategories.size === 1 ? [...categorizedCategories][0] : null,
    replacesRuleCategoryId: replaced ? String(replaced.actions[0].value) : null,
    hasSpecificRule: getRules().some(rule =>
      isSpecificCategoryRule(rule, payeeId),
    ),
  };
}

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
  if (!edited?.payee) {
    throw new Error(`Transaction ${transactionId} has no payee`);
  }
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
    // A null category clears it; the database layer skips undefined
    // fields, but TransactionEntity's optional category omits null
    updated: restore.transactions as Array<Partial<TransactionEntity>>,
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
  // The same row shape batchUpdateTransactions gives the learner
  const transaction = await db.getTransaction(transactionId);
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
  if (!edited?.payee) {
    return [];
  }
  const others = await getOtherRows(edited.payee, transactionId);
  return others
    .filter(t => t.category !== categoryId)
    .map(t => ({ ...t, date: fromDateRepr(t.date) }));
}
