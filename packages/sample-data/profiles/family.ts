import type { Profile } from '../src/profile.ts';

export const profile = {
  id: 'family',
  label: 'Family with kids',
  description:
    'Two incomes, a mortgage, two young kids, bulk shopping and a car to run',

  accounts: [
    { key: 'checking', name: 'Joint Checking', openingBalance: 6800 },
    { key: 'card', name: 'Family Rewards Card', openingBalance: -2150 },
    { key: 'savings', name: 'Emergency Fund', openingBalance: 18000 },
    {
      key: 'college',
      name: '529 College Savings',
      offBudget: true,
      openingBalance: 14200,
    },
    {
      key: 'mortgage',
      name: 'Mortgage',
      offBudget: true,
      openingBalance: -386000,
    },
  ],

  categoryGroups: [
    {
      name: 'Home',
      categories: [
        { name: 'Mortgage', budget: 2640 },
        { name: 'Utilities' },
        { name: 'Internet & Phone' },
        { name: 'Home Maintenance', budget: 150 },
      ],
    },
    {
      name: 'Food',
      categories: [{ name: 'Groceries' }, { name: 'Dining Out' }],
    },
    {
      name: 'Kids',
      categories: [
        { name: 'Childcare', budget: 1650 },
        { name: 'Kids Activities' },
        { name: 'Kids Clothing', budget: 90 },
      ],
    },
    {
      name: 'Car',
      categories: [
        { name: 'Gas' },
        { name: 'Car Insurance', budget: 160 },
        { name: 'Car Maintenance', budget: 60 },
      ],
    },
    {
      name: 'Everyday',
      categories: [
        { name: 'Household Supplies' },
        { name: 'Shopping' },
        { name: 'Subscriptions' },
        { name: 'Medical', budget: 120 },
        { name: 'Gifts', budget: 75 },
      ],
    },
  ],

  income: [
    {
      payee: 'Northwind Health',
      descriptor: 'NORTHWIND HEALTH DIR DEP ##########',
      account: 'checking',
      amount: 2650,
      schedule: { every: 'semimonth', days: [15, 31] },
    },
    {
      payee: 'Riverside School District',
      descriptor: 'RIVERSIDE USD PAYROLL',
      account: 'checking',
      amount: 2150,
      schedule: { every: 'semimonth', days: [10, 25] },
    },
  ],

  recurring: [
    {
      payee: 'Guild Mortgage',
      descriptor: 'GUILD MORTGAGE CO PMT ##########',
      category: 'Mortgage',
      account: 'checking',
      amount: 2640,
      schedule: { every: 'month', day: 1 },
    },
    {
      payee: 'Bright Horizons',
      descriptor: 'BRIGHT HORIZONS TUITION',
      category: 'Childcare',
      account: 'checking',
      amount: 1650,
      schedule: { every: 'month', day: 3 },
    },
    {
      payee: 'City Power & Light',
      descriptor: 'CITY POWER LIGHT AUTOPAY',
      category: 'Utilities',
      account: 'checking',
      amount: 190,
      variance: 0.3,
      schedule: { every: 'month', day: 14 },
    },
    {
      payee: 'Metro Water',
      descriptor: 'METRO WATER UTIL ######',
      category: 'Utilities',
      account: 'checking',
      amount: 68,
      variance: 0.2,
      schedule: { every: 'month', day: 21 },
    },
    {
      payee: 'Verizon',
      descriptor: 'VZWRLSS*APOCC VISB',
      category: 'Internet & Phone',
      account: 'card',
      amount: 145,
      schedule: { every: 'month', day: 9 },
    },
    {
      payee: 'Xfinity',
      descriptor: 'COMCAST XFINITY ####',
      category: 'Internet & Phone',
      account: 'card',
      amount: 80,
      schedule: { every: 'month', day: 16 },
    },
    {
      payee: 'GEICO',
      descriptor: 'GEICO *AUTO',
      category: 'Car Insurance',
      account: 'card',
      amount: 960,
      schedule: { every: 'year', month: 1, day: 6 },
    },
    {
      payee: 'GEICO',
      descriptor: 'GEICO *AUTO',
      category: 'Car Insurance',
      account: 'card',
      amount: 960,
      schedule: { every: 'year', month: 7, day: 6 },
    },
    {
      payee: 'Disney+',
      descriptor: 'DISNEY PLUS',
      category: 'Subscriptions',
      account: 'card',
      amount: 13.99,
      schedule: { every: 'month', day: 11 },
    },
    {
      payee: 'Amazon Prime',
      descriptor: 'AMAZON PRIME*##########',
      category: 'Subscriptions',
      account: 'card',
      amount: 14.99,
      schedule: { every: 'month', day: 19 },
    },
    {
      payee: 'Riverside Swim School',
      descriptor: 'RIVERSIDE SWIM SCHOOL',
      category: 'Kids Activities',
      account: 'card',
      amount: 120,
      schedule: { every: 'month', day: 1 },
    },
  ],

  spending: [
    {
      category: 'Groceries',
      account: 'card',
      perMonth: 9,
      amount: [35, 260],
      weekendShare: 0.45,
      merchants: [
        { name: 'Kroger', descriptor: 'KROGER #### ', weight: 3 },
        { name: 'Costco', descriptor: 'COSTCO WHSE #####', weight: 2 },
        { name: 'Aldi', descriptor: 'ALDI ##### ' },
        { name: 'Instacart', descriptor: 'INSTACART*SUBSCRIPTION' },
      ],
    },
    {
      category: 'Dining Out',
      account: 'card',
      perMonth: 5,
      amount: [25, 110],
      weekendShare: 0.6,
      merchants: [
        { name: 'Chick-fil-A', descriptor: 'CHICK-FIL-A ######', weight: 2 },
        { name: 'Olive Garden', descriptor: 'OLIVE GARDEN ####' },
        { name: 'Panera Bread', descriptor: 'PANERA BREAD #######' },
        { name: "Domino's", descriptor: "DOMINO'S #### " },
      ],
    },
    {
      category: 'Gas',
      account: 'card',
      perMonth: 5,
      amount: [38, 72],
      merchants: [
        { name: 'Shell', descriptor: 'SHELL OIL ###########', weight: 2 },
        { name: 'Costco Gas', descriptor: 'COSTCO GAS #####' },
        { name: 'Chevron', descriptor: 'CHEVRON ####### ' },
      ],
    },
    {
      category: 'Household Supplies',
      account: 'card',
      perMonth: 3,
      amount: [15, 95],
      merchants: [
        { name: 'Target', descriptor: 'TARGET ########', weight: 2 },
        { name: 'Walmart', descriptor: 'WAL-MART #####' },
      ],
    },
    {
      category: 'Shopping',
      account: 'card',
      perMonth: 4,
      amount: [10, 180],
      merchants: [
        { name: 'Amazon', descriptor: 'AMZN Mktp US*##########', weight: 3 },
        { name: 'Home Depot', descriptor: 'THE HOME DEPOT #####' },
        { name: 'Old Navy', descriptor: 'OLD NAVY US ####' },
      ],
    },
    {
      category: 'Kids Activities',
      account: 'card',
      perMonth: 1.5,
      amount: [15, 85],
      weekendShare: 0.7,
      merchants: [
        { name: "Children's Museum", descriptor: 'CHILDRENS MUSEUM ADM' },
        { name: 'Sky Zone', descriptor: 'SKY ZONE TRAMPOLINE' },
        { name: 'Barnes & Noble', descriptor: 'BARNES & NOBLE ####' },
      ],
    },
    {
      category: 'Medical',
      account: 'card',
      perMonth: 1,
      amount: [20, 220],
      merchants: [
        { name: 'Riverside Pediatrics', descriptor: 'RIVERSIDE PEDIATRICS' },
        { name: 'CVS Pharmacy', descriptor: 'CVS/PHARMACY #####' },
      ],
    },
  ],

  transfers: [
    {
      from: 'checking',
      to: 'card',
      amount: 'statement-balance',
      schedule: { every: 'month', day: 22 },
    },
    {
      from: 'checking',
      to: 'savings',
      amount: 1500,
      schedule: { every: 'month', day: 16 },
    },
  ],
} satisfies Profile;
