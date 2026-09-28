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
