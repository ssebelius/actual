import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import prompts from 'prompts';

import { generate } from './generate.ts';
import type { Dataset, GenerateOptions } from './generate.ts';
import type { Profile } from './profile.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..');
const PROFILES_DIR = path.join(PACKAGE_DIR, 'profiles');
// Yarn runs workspace scripts from the package directory; INIT_CWD is where
// the user actually typed the command, which is what relative paths mean.
const USER_CWD = process.env.INIT_CWD ?? process.cwd();

const SPENDING_LEVELS = {
  frugal: 0.8,
  typical: 1,
  comfortable: 1.3,
} as const;
type SpendingLevel = keyof typeof SPENDING_LEVELS;

const HELP = `Generate a realistic sample budget for Actual.

Usage: yarn seed [options]

Runs interactively by default. Any option given on the command line is not
asked again; pass --yes to accept defaults for the rest.

Options:
  --profile <id|path>     Household preset, or a path to your own profile file
  --months <n>            Months of history, ending this month (default 6)
  --spending <level>      frugal | typical | comfortable (default typical)
  --uncategorized <pct>   Percent of transactions left uncategorized (default 15)
  --seed <n>              Same seed, same data (default 2026)
  --end-date <date>       Last day of activity, YYYY-MM-DD (default today)
  --name <name>           Budget name shown in Actual
  --out <dir>             Where to write files (default packages/sample-data/output)
  --yes, -y               Don't prompt; use defaults for anything not given
  --list                  List the built-in profiles and exit
  --help, -h              Show this help

To customize beyond these options, copy a file from packages/sample-data/profiles/,
edit it, and pass its path with --profile.`;

async function main() {
  const { values: args } = parseArgs({
    options: {
      profile: { type: 'string' },
      months: { type: 'string' },
      spending: { type: 'string' },
      uncategorized: { type: 'string' },
      seed: { type: 'string' },
      'end-date': { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      list: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (args.help) {
    console.log(HELP);
    return;
  }

  const profiles = await loadBuiltInProfiles();
  if (args.list) {
    for (const p of profiles) {
      console.log(`${p.id.padEnd(20)} ${p.description}`);
    }
    return;
  }

  const interactive = !args.yes && process.stdin.isTTY;
  const ask = async <T>(question: prompts.PromptObject): Promise<T> => {
    const answer = await prompts(question, {
      onCancel: () => {
        console.log('Cancelled.');
        process.exit(1);
      },
    });
    return answer[question.name as string];
  };

  const profile = args.profile
    ? await resolveProfile(args.profile, profiles)
    : interactive
      ? await ask<Profile>({
          type: 'select',
          name: 'profile',
          message: 'Which household?',
          choices: profiles.map(p => ({
            title: p.label,
            description: p.description,
            value: p,
          })),
        })
      : profiles.find(p => p.id === 'young-professional')!;

  const months = args.months
    ? parsePositiveInt(args.months, 'months')
    : interactive
      ? await ask<number>({
          type: 'number',
          name: 'months',
          message: 'How many months of history?',
          initial: 6,
          min: 1,
          max: 36,
        })
      : 6;

  const spending = args.spending
    ? parseSpendingLevel(args.spending)
    : interactive
      ? await ask<SpendingLevel>({
          type: 'select',
          name: 'spending',
          message: 'Spending level?',
          initial: 1,
          choices: [
            {
              title: 'Frugal',
              description: '20% less day-to-day spending',
              value: 'frugal',
            },
            {
              title: 'Typical',
              description: 'The profile as written',
              value: 'typical',
            },
            {
              title: 'Comfortable',
              description: '30% more day-to-day spending',
              value: 'comfortable',
            },
          ],
        })
      : 'typical';

  const uncategorizedPercent = args.uncategorized
    ? parsePercent(args.uncategorized)
    : interactive
      ? await ask<number>({
          type: 'number',
          name: 'uncategorized',
          message: 'Percent of transactions to leave uncategorized?',
          initial: 15,
          min: 0,
          max: 100,
        })
      : 15;

  const seed = args.seed
    ? parsePositiveInt(args.seed, 'seed')
    : interactive
      ? await ask<number>({
          type: 'number',
          name: 'seed',
          message: 'Random seed (same seed, same data)?',
          initial: 2026,
        })
      : 2026;

  const defaultName = `${profile.label} (sample)`;
  const budgetName = args.name
    ? args.name
    : interactive
      ? await ask<string>({
          type: 'text',
          name: 'name',
          message: 'Budget name?',
          initial: defaultName,
        })
      : defaultName;

  const options: GenerateOptions = {
    months,
    endDate: args['end-date'] ?? today(),
    seed,
    uncategorizedShare: uncategorizedPercent / 100,
    spendingScale: SPENDING_LEVELS[spending],
  };

  let dataset: Dataset;
  try {
    dataset = generate(profile, options);
  } catch (error) {
    // Profile mistakes are the user's to fix; a stack trace only gets in the way.
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
  printSummary(dataset);

  ensureApiBuilt();
  // Imported late: loading the API fails if it hasn't been built yet.
  const { writeBudget } = await import('./write-budget.ts');

  const outDir = path.resolve(
    USER_CWD,
    args.out ?? path.join(PACKAGE_DIR, 'output'),
  );
  const baseName = `${slugify(budgetName)}-seed${seed}`;
  const zipPath = path.join(outDir, `${baseName}.zip`);
  const answerKeyPath = path.join(outDir, `${baseName}.answer-key.json`);

  const dataDir = await mkdtemp(path.join(tmpdir(), 'actual-sample-'));
  try {
    const zip = await writeBudget(dataset, { budgetName, dataDir });
    await mkdir(outDir, { recursive: true });
    await writeFile(zipPath, zip);
    await writeFile(
      answerKeyPath,
      JSON.stringify(answerKey(dataset), null, 2) + '\n',
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`
Wrote ${path.relative(USER_CWD, zipPath)}
  and ${path.relative(USER_CWD, answerKeyPath)}

To open it in Actual:
  1. yarn start, then open http://localhost:3001
  2. Choose "Import my budget" (on the welcome screen, or from the budget
     list via Import file), then "Actual", and pick the .zip above.

The answer key lists the correct category for every transaction left
uncategorized, keyed by imported id, for checking categorization results.`);
}

async function loadBuiltInProfiles(): Promise<Profile[]> {
  const files = (await readdir(PROFILES_DIR))
    .filter(f => f.endsWith('.ts'))
    .sort();
  return Promise.all(files.map(f => importProfile(path.join(PROFILES_DIR, f))));
}

async function resolveProfile(value: string, builtIn: Profile[]) {
  const match = builtIn.find(p => p.id === value);
  if (match) return match;

  const file = path.resolve(USER_CWD, value);
  if (!existsSync(file)) {
    throw new UsageError(
      `No profile "${value}". Built-in profiles: ${builtIn.map(p => p.id).join(', ')}; or pass a path to a profile file.`,
    );
  }
  return importProfile(file);
}

async function importProfile(file: string): Promise<Profile> {
  const module = await import(pathToFileURL(file).href);
  if (!module.profile?.id) {
    throw new UsageError(`${file} must export a Profile named \`profile\``);
  }
  return module.profile;
}

function ensureApiBuilt() {
  if (isApiBundleCurrent()) return;
  console.log('\nBuilding @actual-app/api...');
  // --no-cache: a lage cache hit would skip the build without repairing a
  // dist that was overwritten after it was cached.
  const result = spawnSync('yarn', ['build:api', '--no-cache'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0 || !isApiBundleCurrent()) {
    throw new Error('Building @actual-app/api failed; see the output above.');
  }
}

// The API's Vite build bundles @actual-app/core into dist/index.js. Running
// `tsgo -b` over the API project (as `yarn typecheck` does) replaces that file
// with an unbundled compile that imports @actual-app/core, which cannot run
// under plain Node. Checking for the import catches both a missing and a
// clobbered build.
function isApiBundleCurrent() {
  const entry = path.join(REPO_ROOT, 'packages/api/dist/index.js');
  return (
    existsSync(entry) &&
    !readFileSync(entry, 'utf8').includes("from '@actual-app/core")
  );
}

function printSummary({ transactions, startDate, options, profile }: Dataset) {
  const uncategorized = transactions.filter(t => t.expectedCategory).length;
  console.log(
    `\n${profile.label}: ${transactions.length} transactions from ${startDate} to ${options.endDate}, ${uncategorized} left uncategorized.`,
  );
}

function answerKey({ profile, options, transactions }: Dataset) {
  const accountNames = new Map(profile.accounts.map(a => [a.key, a.name]));
  return {
    profile: profile.id,
    options,
    transactions: transactions
      .filter(t => t.expectedCategory)
      .map(t => ({
        importedId: t.importedId,
        date: t.date,
        account: accountNames.get(t.account),
        payee: t.payee,
        importedPayee: t.importedPayee,
        amount: t.amount,
        expectedCategory: t.expectedCategory,
      })),
  };
}

class UsageError extends Error {}

function parsePositiveInt(value: string, name: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new UsageError(`--${name} must be a whole number of 1 or more`);
  }
  return n;
}

function parsePercent(value: string) {
  const n = Number(value);
  if (!(n >= 0 && n <= 100)) {
    throw new UsageError('--uncategorized must be between 0 and 100');
  }
  return n;
}

function parseSpendingLevel(value: string): SpendingLevel {
  if (!(value in SPENDING_LEVELS)) {
    throw new UsageError(
      `--spending must be one of: ${Object.keys(SPENDING_LEVELS).join(', ')}`,
    );
  }
  return value as SpendingLevel;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

main().catch(error => {
  if (error instanceof UsageError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
