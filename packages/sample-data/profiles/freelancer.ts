import type { Profile } from '../src/profile.ts';

/**
 * Irregular client income and a business card that shares merchants with
 * personal spending (coffee, Amazon, Uber). The right category often depends
 * on which card was used, not just the merchant, which makes this the hardest
 * profile to categorize automatically.
 */
export const profile = {
  id: 'freelancer',
  label: 'Freelance designer',
  description:
    'Lumpy client income, quarterly estimated taxes, business and personal spending that overlap',

  accounts: [
    { key: 'checking', name: 'Checking', openingBalance: 7400 },
    { key: 'card', name: 'Personal Card', openingBalance: -610 },
    { key: 'bizcard', name: 'Business Card', openingBalance: -380 },
    { key: 'taxes', name: 'Tax Savings', openingBalance: 5200 },
    { key: 'ira', name: 'SEP IRA', offBudget: true, openingBalance: 28500 },
  ],

  categoryGroups: [
    {
      name: 'Business',
      categories: [
        { name: 'Software & Tools' },
        { name: 'Coworking' },
        { name: 'Equipment', budget: 150 },
        { name: 'Business Meals' },
        { name: 'Business Travel', budget: 100 },
        { name: 'Professional Development', budget: 50 },
      ],
    },
    {
      name: 'Taxes',
      categories: [{ name: 'Estimated Taxes', budget: 1300 }],
    },
    {
      name: 'Living',
      categories: [
        { name: 'Rent', budget: 1850 },
        { name: 'Utilities' },
        { name: 'Health Insurance' },
        { name: 'Phone' },
      ],
    },
    {
      name: 'Personal',
      categories: [
        { name: 'Groceries' },
        { name: 'Restaurants' },
        { name: 'Coffee' },
        { name: 'Shopping' },
        { name: 'Transportation' },
        { name: 'Subscriptions' },
      ],
    },
  ],

  income: [
    {
      payee: 'Brightline Studio',
      descriptor: 'BRIGHTLINE STUDIO LLC ACH CREDIT',
      account: 'checking',
      amount: 3600,
      variance: 0.35,
      schedule: { every: 'month', day: 6 },
    },
    {
      payee: 'Harbor Labs',
      descriptor: 'HARBOR LABS INC VENDOR PMT',
      account: 'checking',
      amount: 2300,
      variance: 0.5,
      schedule: { every: 'month', day: 21 },
    },
    {
      payee: 'Gumroad',
      descriptor: 'GUMROAD PAYOUT ########',
      account: 'checking',
      amount: 350,
      variance: 0.8,
      schedule: { every: 'two-weeks', anchor: '2026-01-02' },
    },
  ],

  recurring: [
    {
      payee: 'Maple Street Apartments',
      descriptor: 'MAPLE ST APTS ONLINE PMT',
      category: 'Rent',
      account: 'checking',
      amount: 1850,
      schedule: { every: 'month', day: 1 },
    },
    {
      payee: 'Covered California',
      descriptor: 'COVERED CA PREMIUM ########',
      category: 'Health Insurance',
      account: 'checking',
      amount: 480,
      schedule: { every: 'month', day: 4 },
    },
    {
      payee: 'SMUD',
      descriptor: 'SMUD ELECTRIC AUTOPAY',
      category: 'Utilities',
      account: 'checking',
      amount: 90,
      variance: 0.3,
      schedule: { every: 'month', day: 17 },
    },
    {
      payee: 'Visible',
      descriptor: 'VISIBLE SERVICE',
      category: 'Phone',
      account: 'card',
      amount: 30,
      schedule: { every: 'month', day: 8 },
    },
    {
      payee: 'IRS',
      descriptor: 'IRS USATAXPYMT ##############',
      category: 'Estimated Taxes',
      account: 'taxes',
      amount: 3900,
      schedule: { every: 'year', month: 1, day: 15 },
    },
    {
      payee: 'IRS',
      descriptor: 'IRS USATAXPYMT ##############',
      category: 'Estimated Taxes',
      account: 'taxes',
      amount: 3900,
      schedule: { every: 'year', month: 4, day: 15 },
    },
    {
      payee: 'IRS',
      descriptor: 'IRS USATAXPYMT ##############',
      category: 'Estimated Taxes',
      account: 'taxes',
      amount: 3900,
      schedule: { every: 'year', month: 6, day: 15 },
    },
    {
      payee: 'IRS',
      descriptor: 'IRS USATAXPYMT ##############',
      category: 'Estimated Taxes',
      account: 'taxes',
      amount: 3900,
      schedule: { every: 'year', month: 9, day: 15 },
    },
    {
      payee: 'Adobe',
      descriptor: 'ADOBE *CREATIVE CLOUD',
      category: 'Software & Tools',
      account: 'bizcard',
      amount: 59.99,
      schedule: { every: 'month', day: 2 },
    },
    {
      payee: 'Figma',
      descriptor: 'FIGMA MONTHLY RENEWAL',
      category: 'Software & Tools',
      account: 'bizcard',
      amount: 15,
      schedule: { every: 'month', day: 10 },
    },
    {
      payee: 'Google Workspace',
      descriptor: 'GOOGLE *WORKSPACE_STUDIO',
      category: 'Software & Tools',
      account: 'bizcard',
      amount: 14,
      schedule: { every: 'month', day: 1 },
    },
    {
      payee: 'WeWork',
      descriptor: 'WEWORK MEMBERSHIP ######',
      category: 'Coworking',
      account: 'bizcard',
      amount: 350,
      schedule: { every: 'month', day: 1 },
    },
    {
      payee: 'Netflix',
      descriptor: 'NETFLIX.COM',
      category: 'Subscriptions',
      account: 'card',
      amount: 15.49,
      schedule: { every: 'month', day: 13 },
    },
  ],

  spending: [
    {
      category: 'Groceries',
      account: 'card',
      perMonth: 6,
      amount: [20, 130],
      merchants: [
        { name: "Trader Joe's", descriptor: 'TRADER JOE S #### ', weight: 2 },
        { name: 'Safeway', descriptor: 'SAFEWAY #####' },
        { name: 'Sprouts', descriptor: 'SPROUTS FARMERS MKT ###' },
      ],
    },
    {
      category: 'Restaurants',
      account: 'card',
      perMonth: 5,
      amount: [15, 75],
      weekendShare: 0.6,
      merchants: [
        { name: 'Chipotle', descriptor: 'CHIPOTLE ####' },
        { name: 'Pho Bac', descriptor: 'SQ *PHO BAC' },
        { name: 'DoorDash', descriptor: 'DOORDASH*SUSHI HOUSE' },
      ],
    },
    {
      category: 'Coffee',
      account: 'card',
      perMonth: 8,
      amount: [4.5, 8],
      merchants: [
        { name: 'Starbucks', descriptor: 'STARBUCKS STORE #####' },
        { name: 'Temple Coffee', descriptor: 'SQ *TEMPLE COFFEE' },
      ],
    },
    {
      category: 'Shopping',
      account: 'card',
      perMonth: 3,
      amount: [10, 140],
      merchants: [
        { name: 'Amazon', descriptor: 'AMZN Mktp US*##########', weight: 2 },
        { name: 'REI', descriptor: 'REI #### ' },
      ],
    },
    {
      category: 'Transportation',
      account: 'card',
      perMonth: 3,
      amount: [10, 45],
      merchants: [
        { name: 'Uber', descriptor: 'UBER *TRIP HELP.UBER.COM' },
        { name: 'Shell', descriptor: 'SHELL OIL ###########' },
      ],
    },
    // Business spending on the business card, at many of the same merchants.
    {
      category: 'Business Meals',
      account: 'bizcard',
      perMonth: 3,
      amount: [12, 95],
      weekendShare: 0.1,
      merchants: [
        { name: 'Starbucks', descriptor: 'STARBUCKS STORE #####' },
        { name: 'Temple Coffee', descriptor: 'SQ *TEMPLE COFFEE' },
        { name: 'Ella Dining Room', descriptor: 'ELLA DINING ROOM' },
      ],
    },
    {
      category: 'Equipment',
      account: 'bizcard',
      perMonth: 0.6,
      amount: [25, 900],
      merchants: [
        { name: 'Amazon', descriptor: 'AMZN Mktp US*##########', weight: 2 },
        { name: 'Apple Store', descriptor: 'APPLE STORE R###' },
        { name: 'B&H Photo', descriptor: 'B&H PHOTO ###-###-####' },
      ],
    },
    {
      category: 'Business Travel',
      account: 'bizcard',
      perMonth: 0.8,
      amount: [15, 320],
      merchants: [
        { name: 'Uber', descriptor: 'UBER *TRIP HELP.UBER.COM', weight: 3 },
        { name: 'Southwest Airlines', descriptor: 'SOUTHWEST ##########' },
      ],
    },
    {
      category: 'Professional Development',
      account: 'bizcard',
      perMonth: 0.3,
      amount: [20, 400],
      merchants: [
        { name: 'Udemy', descriptor: 'UDEMY ONLINE COURSES' },
        { name: 'AIGA', descriptor: 'AIGA MEMBERSHIP' },
      ],
    },
  ],

  transfers: [
    {
      from: 'checking',
      to: 'card',
      amount: 'statement-balance',
      schedule: { every: 'month', day: 24 },
    },
    {
      from: 'checking',
      to: 'bizcard',
      amount: 'statement-balance',
      schedule: { every: 'month', day: 26 },
    },
    {
      from: 'checking',
      to: 'taxes',
      amount: 1300,
      schedule: { every: 'month', day: 8 },
    },
  ],
} satisfies Profile;
