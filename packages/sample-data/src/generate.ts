import type { Merchant, Profile, Schedule } from './profile.ts';

export type GenerateOptions = {
  /** Number of calendar months of history, ending with the month of `endDate`. */
  months: number;
  /** Last day of generated activity, YYYY-MM-DD. */
  endDate: string;
  /** The same seed and options always produce the same dataset. */
  seed: number;
  /** Share of spending and bill transactions left without a category, 0 to 1. */
  uncategorizedShare: number;
  /** Multiplies day-to-day spending amounts; 1 uses the profile as written. */
  spendingScale: number;
};

export type GeneratedTransaction = {
  /** Stable id, stored as the transaction's imported id in Actual. */
  importedId: string;
  /** Account key from the profile. */
  account: string;
  date: string;
  /** In cents; negative for money leaving the account. */
  amount: number;
  payee: string;
  /** The raw bank description. */
  importedPayee?: string;
  category?: string;
  /** The correct category for a transaction that was left uncategorized. */
  expectedCategory?: string;
  /** Account key on the other side of a transfer. */
  transferTo?: string;
};

export type Dataset = {
  profile: Profile;
  options: GenerateOptions;
  startDate: string;
  /** YYYY-MM, oldest first. */
  months: string[];
  transactions: GeneratedTransaction[];
  /** Budgeted amount in cents per category per month. */
  budgets: Array<{ month: string; category: string; amount: number }>;
};

export const INCOME_CATEGORY = 'Income';

export function generate(profile: Profile, options: GenerateOptions): Dataset {
  validateProfile(profile);

  const random = createRandom(options.seed);
  const months = monthRange(options.endDate, options.months);
  const startDate = `${months[0]}-01`;
  const endDate = options.endDate;
  const inRange = (date: string) => date >= startDate && date <= endDate;

  const drafts: Array<Omit<GeneratedTransaction, 'importedId'>> = [];

  for (const income of profile.income) {
    for (const date of occurrences(income.schedule, months)) {
      if (!inRange(date)) continue;
      drafts.push({
        account: income.account,
        date,
        amount: toCents(vary(random, income.amount, income.variance)),
        payee: income.payee,
        importedPayee: describe(random, income.payee, income.descriptor),
        category: INCOME_CATEGORY,
      });
    }
  }

  for (const bill of profile.recurring) {
    for (const date of occurrences(bill.schedule, months)) {
      if (!inRange(date)) continue;
      drafts.push({
        account: bill.account,
        date,
        amount: -toCents(vary(random, bill.amount, bill.variance)),
        payee: bill.payee,
        importedPayee: describe(random, bill.payee, bill.descriptor),
        category: bill.category,
      });
    }
  }

  for (const spec of profile.spending) {
    const [min, max] = spec.amount;
    for (const month of months) {
      const days = daysOfMonth(month).filter(inRange);
      if (days.length === 0) continue;

      const expected = spec.perMonth * (days.length / daysInMonth(month));
      const count = poisson(random, expected);
      for (let i = 0; i < count; i++) {
        const merchant = pickWeighted(random, spec.merchants);
        const amount =
          (min + (max - min) * random() ** 1.7) * options.spendingScale;
        drafts.push({
          account: spec.account,
          date: pickDay(random, days, spec.weekendShare ?? 2 / 7),
          amount: -toCents(amount),
          payee: merchant.name,
          importedPayee: describe(random, merchant.name, merchant.descriptor),
          category: spec.category,
        });
      }
    }
  }

  for (const transfer of profile.transfers) {
    const toAccount = profile.accounts.find(a => a.key === transfer.to)!;
    for (const date of occurrences(transfer.schedule, months)) {
      if (!inRange(date)) continue;
      const amount =
        transfer.amount === 'statement-balance'
          ? statementBalance(
              drafts,
              transfer.to,
              previousMonth(date),
              startDate,
              toAccount.openingBalance,
            )
          : toCents(transfer.amount);
      if (amount <= 0) continue;
      drafts.push({
        account: transfer.from,
        date,
        amount: -amount,
        payee: toAccount.name,
        transferTo: transfer.to,
      });
    }
  }

  drafts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.account.localeCompare(b.account) ||
      a.payee.localeCompare(b.payee) ||
      a.amount - b.amount,
  );

  const transactions = drafts.map((draft, index): GeneratedTransaction => {
    const transaction = {
      ...draft,
      importedId: `sample-${String(index + 1).padStart(5, '0')}`,
    };
    const canUncategorize =
      transaction.category && transaction.category !== INCOME_CATEGORY;
    if (canUncategorize && random() < options.uncategorizedShare) {
      const { category, ...rest } = transaction;
      return { ...rest, expectedCategory: category };
    }
    return transaction;
  });

  return {
    profile,
    options,
    startDate,
    months,
    transactions,
    budgets: planBudgets(profile, transactions, months, endDate),
  };
}

/**
 * Throws a readable error for the mistakes people make when editing a
 * profile by hand: a misspelled account key or category name.
 */
export function validateProfile(profile: Profile) {
  const accounts = new Set(profile.accounts.map(a => a.key));
  const categories = new Set([
    INCOME_CATEGORY,
    ...profile.categoryGroups.flatMap(g => g.categories.map(c => c.name)),
  ]);
  const problems: string[] = [];

  const checkAccount = (key: string, where: string) => {
    if (!accounts.has(key)) problems.push(`${where}: unknown account "${key}"`);
  };
  const checkCategory = (name: string, where: string) => {
    if (!categories.has(name)) {
      problems.push(`${where}: unknown category "${name}"`);
    }
  };

  for (const i of profile.income) {
    checkAccount(i.account, `income "${i.payee}"`);
  }
  for (const r of profile.recurring) {
    checkAccount(r.account, `recurring "${r.payee}"`);
    checkCategory(r.category, `recurring "${r.payee}"`);
  }
  for (const s of profile.spending) {
    checkAccount(s.account, `spending "${s.category}"`);
    checkCategory(s.category, `spending "${s.category}"`);
    if (s.merchants.length === 0) {
      problems.push(`spending "${s.category}": no merchants`);
    }
    if (s.amount[0] > s.amount[1]) {
      problems.push(`spending "${s.category}": amount min is above max`);
    }
  }
  for (const t of profile.transfers) {
    checkAccount(t.from, `transfer ${t.from} -> ${t.to}`);
    checkAccount(t.to, `transfer ${t.from} -> ${t.to}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Profile "${profile.id}" has problems:\n  ${[...new Set(problems)].join('\n  ')}`,
    );
  }
}

function planBudgets(
  profile: Profile,
  transactions: GeneratedTransaction[],
  months: string[],
  endDate: string,
) {
  // Derive typical spend from complete months only; a half-finished current
  // month would pull every average down.
  const lastMonthComplete =
    endDate === `${months.at(-1)}-${pad(daysInMonth(months.at(-1)!))}`;
  const completeMonths = lastMonthComplete ? months : months.slice(0, -1);
  const basis = new Set(completeMonths.length > 0 ? completeMonths : months);

  const spent = new Map<string, number>();
  for (const t of transactions) {
    const category = t.category ?? t.expectedCategory;
    if (!category || category === INCOME_CATEGORY) continue;
    if (!basis.has(t.date.slice(0, 7))) continue;
    spent.set(category, (spent.get(category) ?? 0) - t.amount);
  }

  const budgets: Dataset['budgets'] = [];
  for (const category of profile.categoryGroups.flatMap(g => g.categories)) {
    const amount =
      category.budget !== undefined
        ? toCents(category.budget)
        : Math.ceil((spent.get(category.name) ?? 0) / basis.size / 1000) * 1000;
    if (amount <= 0) continue;
    for (const month of months) {
      budgets.push({ month, category: category.name, amount });
    }
  }
  return budgets;
}

/** Net charges on an account during `month`, as a positive amount to pay. */
function statementBalance(
  drafts: Array<Omit<GeneratedTransaction, 'importedId'>>,
  account: string,
  month: string,
  startDate: string,
  openingBalance: number,
) {
  if (`${month}-01` < startDate) {
    // The statement predates the generated range; pay the opening balance.
    return -toCents(openingBalance);
  }
  let total = 0;
  for (const d of drafts) {
    if (d.account === account && !d.transferTo && d.date.startsWith(month)) {
      total += d.amount;
    }
  }
  return -total;
}

function occurrences(schedule: Schedule, months: string[]): string[] {
  switch (schedule.every) {
    case 'month':
      return months.map(m => dayInMonth(m, schedule.day));
    case 'semimonth':
      return months.flatMap(m => schedule.days.map(day => dayInMonth(m, day)));
    case 'year':
      return months
        .filter(m => Number(m.slice(5)) === schedule.month)
        .map(m => dayInMonth(m, schedule.day));
    case 'two-weeks': {
      const first = parseDate(`${months[0]}-01`);
      const last = parseDate(
        `${months.at(-1)}-${pad(daysInMonth(months.at(-1)!))}`,
      );
      const anchor = parseDate(schedule.anchor);
      const offset = ((Math.round((first - anchor) / DAY) % 14) + 14) % 14;
      const dates: string[] = [];
      for (
        let t = first + ((14 - offset) % 14) * DAY;
        t <= last;
        t += 14 * DAY
      ) {
        dates.push(formatDate(t));
      }
      return dates;
    }
    default:
      // Reachable from hand-edited profiles that skip the type check.
      throw new Error(
        `Unknown schedule ${JSON.stringify(schedule)}; "every" must be month, semimonth, two-weeks or year`,
      );
  }
}

// Seeded PRNG (mulberry32): small, fast, and identical on every platform.
export function createRandom(seed: number) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = ReturnType<typeof createRandom>;

function poisson(random: Random, mean: number) {
  const limit = Math.exp(-mean);
  let count = 0;
  let product = random();
  while (product > limit) {
    count++;
    product *= random();
  }
  return count;
}

function pickWeighted(random: Random, merchants: Merchant[]) {
  const total = merchants.reduce((sum, m) => sum + (m.weight ?? 1), 0);
  let roll = random() * total;
  for (const merchant of merchants) {
    roll -= merchant.weight ?? 1;
    if (roll < 0) return merchant;
  }
  return merchants.at(-1)!;
}

function pickDay(random: Random, days: string[], weekendShare: number) {
  const wantWeekend = random() < weekendShare;
  const matching = days.filter(d => isWeekend(d) === wantWeekend);
  const pool = matching.length > 0 ? matching : days;
  return pool[Math.floor(random() * pool.length)];
}

function vary(random: Random, amount: number, variance = 0) {
  return amount * (1 + (random() * 2 - 1) * variance);
}

function describe(random: Random, name: string, descriptor?: string) {
  return (descriptor ?? name.toUpperCase()).replace(/#/g, () =>
    String(Math.floor(random() * 10)),
  );
}

function toCents(amount: number) {
  return Math.round(amount * 100);
}

// Date helpers. Dates are YYYY-MM-DD strings and are handled in UTC so the
// output does not depend on the machine's time zone.
const DAY = 24 * 60 * 60 * 1000;

function parseDate(date: string) {
  return Date.parse(`${date}T00:00:00Z`);
}

function formatDate(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function daysInMonth(month: string) {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

function dayInMonth(month: string, day: number) {
  return `${month}-${pad(Math.min(day, daysInMonth(month)))}`;
}

function daysOfMonth(month: string) {
  return Array.from(
    { length: daysInMonth(month) },
    (_, i) => `${month}-${pad(i + 1)}`,
  );
}

function isWeekend(date: string) {
  const day = new Date(parseDate(date)).getUTCDay();
  return day === 0 || day === 6;
}

function previousMonth(date: string) {
  const [year, month] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return formatDate(d.getTime()).slice(0, 7);
}

function monthRange(endDate: string, count: number) {
  const [year, month] = endDate.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - count + i, 1));
    return formatDate(d.getTime()).slice(0, 7);
  });
}
