import type { Profile } from '../src/profile.ts';

export const profile = {
  id: 'young-professional',
  label: 'Young professional',
  description:
    'Single renter in a city: steady biweekly pay, most spending on a credit card',

  accounts: [
    { key: 'checking', name: 'Checking', openingBalance: 3200 },
    { key: 'card', name: 'Rewards Credit Card', openingBalance: -840 },
    { key: 'savings', name: 'High-Yield Savings', openingBalance: 9500 },
    {
      key: 'retirement',
      name: '401(k)',
      offBudget: true,
      openingBalance: 41000,
    },
  ],

  categoryGroups: [
    {
      name: 'Housing',
      categories: [
        { name: 'Rent', budget: 2100 },
        { name: 'Utilities' },
        { name: 'Internet & Phone' },
        { name: 'Renters Insurance' },
      ],
    },
    {
      name: 'Food',
      categories: [
        { name: 'Groceries' },
        { name: 'Restaurants' },
        { name: 'Coffee' },
      ],
    },
    {
      name: 'Getting Around',
      categories: [{ name: 'Transit' }, { name: 'Rideshare' }],
    },
    {
      name: 'Lifestyle',
      categories: [
        { name: 'Shopping' },
        { name: 'Entertainment' },
        { name: 'Subscriptions' },
        { name: 'Fitness' },
        { name: 'Personal Care' },
      ],
    },
    {
      name: 'Health',
      categories: [{ name: 'Medical', budget: 60 }],
    },
  ],

  income: [
    {
      payee: 'Acme Corp',
      descriptor: 'ACME CORP PAYROLL PPD ID: ##########',
      account: 'checking',
      amount: 2650,
      schedule: { every: 'two-weeks', anchor: '2026-01-09' },
    },
  ],

  recurring: [
    {
      payee: 'Parkside Property Management',
      descriptor: 'ZELLE TO PARKSIDE PROPERTY MGMT CONF# ########',
      category: 'Rent',
      account: 'checking',
      amount: 2100,
      schedule: { every: 'month', day: 1 },
    },
    {
      payee: 'PG&E',
      descriptor: 'PGANDE WEB ONLINE ##########',
      category: 'Utilities',
      account: 'checking',
      amount: 85,
      variance: 0.25,
      schedule: { every: 'month', day: 18 },
    },
    {
      payee: 'Comcast',
      descriptor: 'COMCAST CALIFORNIA ####',
      category: 'Internet & Phone',
      account: 'card',
      amount: 70,
      schedule: { every: 'month', day: 12 },
    },
    {
      payee: 'T-Mobile',
      descriptor: 'TMOBILE*AUTO PAY',
      category: 'Internet & Phone',
      account: 'card',
      amount: 65,
      schedule: { every: 'month', day: 20 },
    },
    {
      payee: 'Lemonade Insurance',
      descriptor: 'LEMONADE I* RENTERS',
      category: 'Renters Insurance',
      account: 'card',
      amount: 12,
      schedule: { every: 'month', day: 5 },
    },
    {
      payee: 'Netflix',
      descriptor: 'NETFLIX.COM',
      category: 'Subscriptions',
      account: 'card',
      amount: 15.49,
      schedule: { every: 'month', day: 7 },
    },
    {
      payee: 'Spotify',
      descriptor: 'SPOTIFY USA',
      category: 'Subscriptions',
      account: 'card',
      amount: 11.99,
      schedule: { every: 'month', day: 22 },
    },
    {
      payee: 'Apple iCloud',
      descriptor: 'APPLE.COM/BILL',
      category: 'Subscriptions',
      account: 'card',
      amount: 2.99,
      schedule: { every: 'month', day: 3 },
    },
    {
      payee: 'Planet Fitness',
      descriptor: 'PLANET FITNESS CLUB ####',
      category: 'Fitness',
      account: 'card',
      amount: 24.99,
      schedule: { every: 'month', day: 15 },
    },
  ],

  spending: [
    {
      category: 'Groceries',
      account: 'card',
      perMonth: 7,
      amount: [22, 140],
      merchants: [
        { name: "Trader Joe's", descriptor: 'TRADER JOE S #### ', weight: 3 },
        { name: 'Whole Foods', descriptor: 'WHOLEFDS MKT #####', weight: 2 },
        { name: 'Safeway', descriptor: 'SAFEWAY #####' },
      ],
    },
    {
      category: 'Restaurants',
      account: 'card',
      perMonth: 8,
      amount: [16, 85],
      weekendShare: 0.5,
      merchants: [
        { name: 'Chipotle', descriptor: 'CHIPOTLE ####', weight: 2 },
        { name: 'Sweetgreen', descriptor: 'SWEETGREEN ####', weight: 2 },
        { name: 'La Taqueria', descriptor: 'TST* LA TAQUERIA' },
        { name: 'DoorDash', descriptor: 'DOORDASH*THAI BASIL', weight: 2 },
        { name: 'Nopa', descriptor: 'SQ *NOPA SAN FRANCISCO' },
      ],
    },
    {
      category: 'Coffee',
      account: 'card',
      perMonth: 12,
      amount: [4.5, 9],
      weekendShare: 0.2,
      merchants: [
        {
          name: 'Blue Bottle Coffee',
          descriptor: 'SQ *BLUE BOTTLE COFFEE',
          weight: 2,
        },
        { name: 'Starbucks', descriptor: 'STARBUCKS STORE #####', weight: 2 },
        { name: "Peet's Coffee", descriptor: 'PEETS #### ' },
      ],
    },
    {
      category: 'Transit',
      account: 'card',
      perMonth: 3,
      amount: [5, 40],
      merchants: [{ name: 'Clipper', descriptor: 'CLIPPER SYSTEMS MOBILE' }],
    },
    {
      category: 'Rideshare',
      account: 'card',
      perMonth: 3,
      amount: [11, 38],
      weekendShare: 0.6,
      merchants: [
        { name: 'Uber', descriptor: 'UBER *TRIP HELP.UBER.COM', weight: 2 },
        { name: 'Lyft', descriptor: 'LYFT *RIDE ### ####' },
      ],
    },
    {
      category: 'Shopping',
      account: 'card',
      perMonth: 4,
      amount: [12, 160],
      merchants: [
        { name: 'Amazon', descriptor: 'AMZN Mktp US*##########', weight: 3 },
        { name: 'Target', descriptor: 'TARGET ########' },
        { name: 'Uniqlo', descriptor: 'UNIQLO USA ####' },
      ],
    },
    {
      category: 'Entertainment',
      account: 'card',
      perMonth: 2,
      amount: [12, 90],
      weekendShare: 0.6,
      merchants: [
        { name: 'AMC Theatres', descriptor: 'AMC #### ONLINE' },
        { name: 'Ticketmaster', descriptor: 'TICKETMASTER *EVENT' },
        { name: 'Steam', descriptor: 'STEAMGAMES.COM #########' },
      ],
    },
    {
      category: 'Personal Care',
      account: 'card',
      perMonth: 1.5,
      amount: [12, 70],
      merchants: [
        { name: 'CVS Pharmacy', descriptor: 'CVS/PHARMACY #####' },
        { name: 'Sephora', descriptor: 'SEPHORA.COM' },
        { name: 'Great Clips', descriptor: 'GREAT CLIPS ####' },
      ],
    },
    {
      category: 'Medical',
      account: 'card',
      perMonth: 0.4,
      amount: [25, 180],
      merchants: [
        { name: 'One Medical', descriptor: 'ONE MEDICAL GROUP' },
        { name: 'Walgreens', descriptor: 'WALGREENS #####' },
      ],
    },
  ],

  transfers: [
    {
      from: 'checking',
      to: 'card',
      amount: 'statement-balance',
      schedule: { every: 'month', day: 25 },
    },
    {
      from: 'checking',
      to: 'savings',
      amount: 1600,
      schedule: { every: 'month', day: 2 },
    },
  ],
} satisfies Profile;
