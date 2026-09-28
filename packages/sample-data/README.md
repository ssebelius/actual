# Sample data

Everything needed to try Actual with realistic data, without a sync server or
a bank connection:

- `yarn seed` generates a reproducible sample budget and writes it as an
  Actual export (`.zip`) that the app can import directly. Most of this README
  is about it.
- [`bank-files/`](bank-files/) holds two small bank downloads for trying
  [setup from bank files](#sample-bank-files) on a new budget.

## Quick start

From the repository root, with Node 22.18 or newer (the repo pins 24 in `.nvmrc`):

```bash
yarn install
yarn seed          # answer a few questions, or: yarn seed --yes
yarn start         # then open http://localhost:3001
```

In the app, choose **Import my budget → Actual** and pick the `.zip` that
`yarn seed` printed. It is written to `packages/sample-data/output/`.

The first run builds `@actual-app/api`, which takes a few seconds.

## What you get

- Accounts with opening balances: checking, credit cards, savings, and
  off-budget accounts such as a 401(k) or mortgage.
- Paychecks, bills and subscriptions on realistic schedules; day-to-day
  spending at named merchants with bank-style raw descriptions
  (`SQ *BLUE BOTTLE COFFEE`, `AMZN Mktp US*2K4…`).
- Credit cards paid off monthly from checking by transfer, and regular
  transfers into savings.
- A monthly budget for every category, set from what the household
  typically spends unless the profile fixes an amount.
- A share of transactions left uncategorized, as they would be after a bank
  import, plus an answer key (below).

The same options and seed always produce the same data.

## Options

Every option can be given on the command line. Anything you leave out is
asked interactively, or takes its default with `--yes`.

| Option                  | Default                       | Meaning                                         |
| ----------------------- | ----------------------------- | ----------------------------------------------- |
| `--profile <id\|path>`  | `young-professional`          | Household preset, or a path to your own profile |
| `--months <n>`          | `6`                           | Months of history, ending this month            |
| `--spending <level>`    | `typical`                     | `frugal`, `typical` or `comfortable`            |
| `--uncategorized <pct>` | `15`                          | Percent of transactions left uncategorized      |
| `--seed <n>`            | `2026`                        | Change it for different data of the same shape  |
| `--end-date <date>`     | today                         | Last day of activity, `YYYY-MM-DD`              |
| `--name <name>`         | from the profile              | Budget name shown in Actual                     |
| `--out <dir>`           | `packages/sample-data/output` | Where files are written                         |

`yarn seed --list` shows the built-in profiles:

- `young-professional`: single renter, biweekly pay, most spending on one card.
- `family`: two incomes, mortgage, childcare, bulk shopping, a car.
- `freelancer`: irregular client income, quarterly taxes, and a business card
  that shares merchants with personal spending. The right category often
  depends on which card was used, which makes it the hardest to categorize.

## Sample bank files

`bank-files/` has one statement from each of two Chase accounts, the same
files the end-to-end test for bank file setup uses:

- `chase-checking.qfx`: 8 checking transactions from July 1 to August 3,
  2026, with the bank's balance of $6,210.48 on August 3.
- `chase-sapphire.csv`: 6 credit card transactions in Chase's CSV layout,
  with no balance in the file.

To try them, start the app, choose **Start budgeting**, then **Set up from bank
files**, and:

1. Add `chase-checking.qfx` to the first account. Setup reads the bank from
   the file (JPMorgan Chase) and the balance from its ledger balance; give
   the account a name.
2. Choose **Add account**, set the new account's type to **Credit card**, and
   add `chase-sapphire.csv`. Map the columns: date is `Transaction Date`,
   payee is `Description`, amount is `Amount`, and the date format is
   `MM/DD/YYYY`.
3. Enter **412.60** as the amount owed on the card.
4. Under **Likely transfers**, confirm the $523.10 card payment, which appears
   in both files.

The review shows starting balances of $1,250.00 for checking and $721.95 owed
on the card, which make each account's history add up to its balance. Create
makes 2 accounts and 14 transactions, and the sidebar shows $6,210.48 in
checking, -$412.60 on the card, and $5,797.88 in total.

## Custom households

Copy a profile, edit it, and pass its path:

```bash
cp packages/sample-data/profiles/family.ts my-household.ts
yarn seed --profile ./my-household.ts
```

A profile lists accounts, category groups, income, recurring bills,
day-to-day spending and transfers. The fields are documented in
[`src/profile.ts`](src/profile.ts); an editor gives autocomplete and type
errors because profiles are typed with `satisfies Profile`. Amounts are in
dollars. In a merchant's `descriptor`, each `#` becomes a random digit.

If an account key or category name doesn't match, `yarn seed` lists every
mismatch before writing anything.

## Answer key

Next to the `.zip`, `<name>.answer-key.json` lists every transaction that was
left uncategorized with the category it should have:

```json
{
  "importedId": "sample-00005",
  "date": "2026-04-04",
  "account": "Business Card",
  "payee": "AIGA",
  "importedPayee": "AIGA MEMBERSHIP",
  "amount": -3510,
  "expectedCategory": "Professional Development"
}
```

`importedId` is stored on the transaction in Actual (its `imported_id`), so
results from any categorization approach can be scored against the key.
Amounts are in cents.

## Development

```bash
yarn workspace @actual-app/sample-data run test
yarn workspace @actual-app/sample-data run typecheck
```

`src/generate.ts` turns a profile into a dataset and has no dependencies, so
it is unit tested directly. `src/write-budget.ts` writes a dataset through
`@actual-app/api`, and `src/cli.ts` handles prompts, options and files.

Running `yarn typecheck` from the root rebuilds `packages/api/dist` with an
unbundled compile that can't run on its own. `yarn seed` detects this and
rebuilds the API before continuing.
