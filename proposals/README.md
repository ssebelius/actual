# Proposals

This branch adds two features to Actual and the sample data used to build and
demo them. Each feature has a folder here with the documents that led to it.
Read the PRD first: it states the problem and what the feature must do. The
technical design and the UX directions build on it.

| Feature                                                                          | What it does                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Start a budget from bank files](bank-file-setup/bank-file-setup-prd.md)         | A new budget can be set up from files downloaded from several banks in one pass, with a review of everything before it is written and starting balances that make each account add up to the bank's balance. |
| [Categorize a merchant everywhere at once](category-offer/category-offer-prd.md) | After a category edit, Actual offers to give the same category to the merchant's other uncategorized transactions and to save a rule for future ones.                                                        |

The two meet in the middle: bank file setup imports history uncategorized and
ends on the uncategorized list, which is where the category offer does its
work.

## How each folder is organized

Every feature folder has the same layout, with file names prefixed by the
feature:

| File                           | Contents                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `<feature>-prd.md`             | The problem, how Actual behaves today, goals, requirements and open questions              |
| `<feature>-tdd.md`             | The technical design: how it is built, the decisions and the alternatives considered       |
| `<feature>-ux.md`              | The UX directions that were explored, which one was chosen and why, and the UX review      |
| `ux/`                          | The clickable prototype, screenshots, and demo videos with the scripts that record them    |
| `process/<feature>-reviews.md` | Every review finding, including code and competitor research, and what was done about each |
| `process/<feature>-plan.md`    | The task-by-task implementation plan the code was built from                               |

## Sample data

[`packages/sample-data`](../packages/sample-data/README.md) holds what you
need to try both features without a bank connection:

- `yarn seed` generates a realistic, reproducible household budget with a
  share of transactions left uncategorized, plus an answer key of the
  categories they should have. Profiles cover a young professional, a family,
  and a freelancer whose business and personal spending share merchants.
- `bank-files/` holds a Chase checking QFX and a Chase credit card CSV for
  trying bank file setup.

## Trying it

```bash
yarn install
yarn start            # http://localhost:3001, choose "Don't use a server"
```

**Bank file setup.** Choose **Start budgeting**, then **Set up from bank
files**, and follow the steps in the
[sample data README](../packages/sample-data/README.md#sample-bank-files).

**Category offer.** Generate the family budget and import it from the welcome
screen with **Import my budget**, then **Actual**:

```bash
yarn seed --profile family --yes --end-date 2026-09-27
```

Open the Family Rewards Card account, search for Chick-fil-A, and set the
uncategorized April 17 purchase to Dining Out. The offer appears under the
row; Apply sets the April 4 purchase too and saves a rule you can see on the
Rules page.

## Demo videos

Each recording runs the feature in the app, using the steps above:

- [Bank file setup](bank-file-setup/ux/bank-file-setup-demo.webm) (73 seconds)
- [Category offer](category-offer/ux/category-offer-demo.webm) (49 seconds)

The scripts that record them are next to the videos, in `ux/record-demo.mjs`.
Run one from the repository root with the app running, for example
`node proposals/category-offer/ux/record-demo.mjs`.
