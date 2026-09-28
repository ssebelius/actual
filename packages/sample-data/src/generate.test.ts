import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { profile as family } from '../profiles/family.ts';
import { profile as freelancer } from '../profiles/freelancer.ts';
import { profile as youngProfessional } from '../profiles/young-professional.ts';

import { generate, INCOME_CATEGORY, validateProfile } from './generate.ts';
import type { GenerateOptions } from './generate.ts';
import type { Profile } from './profile.ts';

const options: GenerateOptions = {
  months: 6,
  endDate: '2026-09-27',
  seed: 7,
  uncategorizedShare: 0.15,
  spendingScale: 1,
};

describe('generate', () => {
  it('produces identical data for the same seed and different data for another', () => {
    const first = generate(youngProfessional, options);
    const again = generate(youngProfessional, options);
    const other = generate(youngProfessional, { ...options, seed: 8 });

    expect(again.transactions).toEqual(first.transactions);
    expect(other.transactions).not.toEqual(first.transactions);
  });

  it('keeps every transaction inside the requested range', () => {
    const { transactions, startDate, months } = generate(family, options);

    expect(startDate).toBe('2026-04-01');
    expect(months).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    for (const t of transactions) {
      expect(t.date >= '2026-04-01' && t.date <= '2026-09-27').toBe(true);
    }
  });

  it('gives every transaction a unique imported id and whole-cent amount', () => {
    const { transactions } = generate(freelancer, options);
    const ids = new Set(transactions.map(t => t.importedId));

    expect(ids.size).toBe(transactions.length);
    for (const t of transactions) expect(Number.isInteger(t.amount)).toBe(true);
  });

  it('leaves the requested share uncategorized and records the right answer', () => {
    const none = generate(youngProfessional, {
      ...options,
      uncategorizedShare: 0,
    });
    const all = generate(youngProfessional, {
      ...options,
      uncategorizedShare: 1,
    });

    expect(none.transactions.some(t => t.expectedCategory)).toBe(false);
    for (const t of all.transactions) {
      if (t.transferTo || t.category === INCOME_CATEGORY) {
        expect(t.expectedCategory).toBeUndefined();
      } else {
        expect(t.category).toBeUndefined();
        expect(t.expectedCategory).toBeTruthy();
      }
    }
  });

  it("pays a card off with exactly the previous month's charges", () => {
    const { transactions } = generate(youngProfessional, options);
    const augustCharges = transactions
      .filter(
        t =>
          t.account === 'card' && !t.transferTo && t.date.startsWith('2026-08'),
      )
      .reduce((sum, t) => sum + t.amount, 0);
    const septemberPayment = transactions.find(
      t => t.transferTo === 'card' && t.date.startsWith('2026-09'),
    );

    expect(septemberPayment?.amount).toBe(augustCharges);
  });

  it('pays every 14 days on a two-week schedule', () => {
    const { transactions } = generate(youngProfessional, options);
    const paydays = transactions
      .filter(t => t.payee === 'Acme Corp')
      .map(t => Date.parse(t.date));

    for (let i = 1; i < paydays.length; i++) {
      expect((paydays[i] - paydays[i - 1]) / 86_400_000).toBe(14);
    }
  });

  it('budgets each category the same amount every month', () => {
    const { budgets, months } = generate(family, options);
    const mortgage = budgets.filter(b => b.category === 'Mortgage');

    expect(mortgage).toHaveLength(months.length);
    expect(mortgage.every(b => b.amount === 264000)).toBe(true);
  });
});

describe('validateProfile', () => {
  it('names each unknown account and category', () => {
    const broken: Profile = {
      ...youngProfessional,
      spending: [
        {
          ...youngProfessional.spending[0],
          account: 'chequing',
          category: 'Grocery',
        },
      ],
    };

    expect(() => validateProfile(broken)).toThrow(
      /unknown account "chequing"[\s\S]*unknown category "Grocery"/,
    );
  });

  it('accepts every built-in profile', async () => {
    const dir = path.resolve(import.meta.dirname, '../profiles');
    for (const file of readdirSync(dir)) {
      const { profile } = await import(path.join(dir, file));
      expect(() => validateProfile(profile)).not.toThrow();
    }
  });
});
