/**
 * A household profile describes the shape of a sample budget: its accounts,
 * categories, where money comes from and where it goes. The generator turns a
 * profile into concrete transactions for a date range.
 *
 * All amounts in a profile are in whole currency units (dollars), which keeps
 * profiles easy to read and edit. The generator converts them to cents.
 */
export type Profile = {
  /** Used with `--profile <id>`. */
  id: string;
  label: string;
  description: string;
  accounts: AccountSpec[];
  categoryGroups: CategoryGroupSpec[];
  income: IncomeSpec[];
  /** Bills and subscriptions: same payee, predictable timing. */
  recurring: RecurringSpec[];
  /** Day-to-day spending: many merchants, random timing and amounts. */
  spending: SpendingSpec[];
  /** Money moving between the household's own accounts. */
  transfers: TransferSpec[];
};

export type AccountSpec = {
  /** Referenced by income, recurring, spending and transfers. */
  key: string;
  name: string;
  /** Off-budget accounts (investments, loans, assets) are tracked but not budgeted. */
  offBudget?: boolean;
  /** Balance on the first day of the generated range. Negative for debts. */
  openingBalance: number;
};

export type CategoryGroupSpec = {
  name: string;
  categories: CategorySpec[];
};

export type CategorySpec = {
  name: string;
  /**
   * Monthly budgeted amount. Leave it out to budget what the household
   * typically spends in this category, rounded up to the nearest 10.
   */
  budget?: number;
};

export type Merchant = {
  /** The clean payee name shown in Actual. */
  name: string;
  /**
   * The raw description a bank export would show, e.g. `SQ *BLUE BOTTLE ####`.
   * Each `#` becomes a random digit. Defaults to the name in upper case.
   */
  descriptor?: string;
  /** Relative likelihood of this merchant within its category. Defaults to 1. */
  weight?: number;
};

export type Schedule =
  | { every: 'month'; day: number }
  | { every: 'semimonth'; days: [number, number] }
  /** Every 14 days, counted from `anchor` (YYYY-MM-DD). */
  | { every: 'two-weeks'; anchor: string }
  | { every: 'year'; month: number; day: number };

export type IncomeSpec = {
  payee: string;
  descriptor?: string;
  account: string;
  amount: number;
  /** Random variation as a fraction of `amount`, e.g. 0.3 for ±30%. */
  variance?: number;
  schedule: Schedule;
};

export type RecurringSpec = {
  payee: string;
  descriptor?: string;
  category: string;
  account: string;
  amount: number;
  /** Random variation as a fraction of `amount`, e.g. 0.15 for utilities. */
  variance?: number;
  schedule: Schedule;
};

export type SpendingSpec = {
  category: string;
  account: string;
  /** Average number of purchases per month. */
  perMonth: number;
  /** Purchase amounts fall in this range, skewed toward the low end. */
  amount: [min: number, max: number];
  merchants: Merchant[];
  /** Chance a purchase lands on a weekend, from 0 to 1. Defaults to 2/7. */
  weekendShare?: number;
};

export type TransferSpec = {
  from: string;
  to: string;
  /**
   * A fixed amount, or `statement-balance` to pay off everything charged to
   * the `to` account (a credit card) during the previous calendar month.
   */
  amount: number | 'statement-balance';
  schedule: Schedule;
};
