import * as api from '@actual-app/api';

import { INCOME_CATEGORY } from './generate.ts';
import type { Dataset } from './generate.ts';

const STARTING_BALANCES_CATEGORY = 'Starting Balances';

/**
 * Creates a new local budget from a dataset and returns it as an Actual
 * export (.zip), ready for "Import my budget → Actual" in the app.
 */
export async function writeBudget(
  dataset: Dataset,
  { budgetName, dataDir }: { budgetName: string; dataDir: string },
): Promise<Uint8Array> {
  await api.init({ dataDir, verbose: false });
  try {
    await withoutUploadWarning(() =>
      api.runImport(budgetName, () => populate(dataset)),
    );
    return await api.exportBudget();
  } finally {
    await api.shutdown();
  }
}

async function populate(dataset: Dataset) {
  const { profile, transactions, budgets, startDate, options } = dataset;

  const accountIds = new Map<string, string>();
  for (const account of profile.accounts) {
    const id = await api.createAccount({
      name: account.name,
      offbudget: account.offBudget ?? false,
    });
    accountIds.set(account.key, id);
  }

  const categoryIds = new Map<string, string>();
  for (const category of await api.getCategories()) {
    if ('group_id' in category) categoryIds.set(category.name, category.id);
  }
  if (!categoryIds.has(INCOME_CATEGORY)) {
    throw new Error(`The new budget has no "${INCOME_CATEGORY}" category`);
  }
  for (const group of profile.categoryGroups) {
    const groupId = await api.createCategoryGroup({ name: group.name });
    for (const category of group.categories) {
      const id = await api.createCategory({
        name: category.name,
        group_id: groupId,
      });
      categoryIds.set(category.name, id);
    }
  }

  const transferPayees = new Map<string, string>();
  for (const payee of await api.getPayees()) {
    if (payee.transfer_acct) transferPayees.set(payee.transfer_acct, payee.id);
  }

  // Transactions older than a few days are cleared, like a real register
  // where the newest charges are still pending.
  const clearedBefore = shiftDays(options.endDate, -3);

  for (const account of profile.accounts) {
    const accountId = accountIds.get(account.key)!;
    const rows: Parameters<typeof api.addTransactions>[1] = [];

    if (account.openingBalance !== 0) {
      rows.push({
        date: startDate,
        amount: Math.round(account.openingBalance * 100),
        payee_name: 'Starting Balance',
        category: account.offBudget
          ? undefined
          : categoryIds.get(STARTING_BALANCES_CATEGORY),
        cleared: true,
      });
    }

    for (const t of transactions) {
      if (t.account !== account.key) continue;
      const transferPayee = t.transferTo
        ? transferPayees.get(accountIds.get(t.transferTo)!)
        : undefined;
      rows.push({
        date: t.date,
        amount: t.amount,
        ...(transferPayee ? { payee: transferPayee } : { payee_name: t.payee }),
        imported_payee: t.importedPayee,
        imported_id: t.importedId,
        category: t.category ? categoryIds.get(t.category) : undefined,
        cleared: t.date < clearedBefore,
      });
    }

    // runTransfers creates the matching transaction in the other account.
    await api.addTransactions(accountId, rows, { runTransfers: true });
  }

  for (const budget of budgets) {
    await api.setBudgetAmount(
      budget.month,
      categoryIds.get(budget.category)!,
      budget.amount,
    );
  }
}

// Finishing an import tries to upload the budget to a sync server. There is
// none here, so the resulting warning is expected and only confuses people.
async function withoutUploadWarning<T>(fn: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes('cloudStorage.upload failed')) return;
    warn(...args);
  };
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}

function shiftDays(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(time).toISOString().slice(0, 10);
}
