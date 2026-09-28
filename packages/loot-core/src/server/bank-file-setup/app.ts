import { logger } from '#platform/server/log';
import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { batchMessages } from '#server/sync';
import { parseFileContents } from '#server/transactions/import/parse-file';
import type {
  ParseFileOptions,
  ParseFileResult,
} from '#server/transactions/import/parse-file';
import { undoable } from '#server/undo';

import { planCreate, SetupValidationError } from './plan-create';
import type { CreatePlan, SetupCreateInput } from './plan-create';

export type SetupCreateResult =
  | {
      ok: true;
      accountIds: string[];
      transactionCount: number;
      warning?: string;
    }
  | { ok: false; error: string };

export type BankFileSetupHandlers = {
  'setup-parse-file': (args: {
    name: string;
    bytes: Uint8Array;
    options?: ParseFileOptions;
  }) => Promise<ParseFileResult>;
  'setup-create': (input: SetupCreateInput) => Promise<SetupCreateResult>;
};

export const app = createApp<BankFileSetupHandlers>();
// Not a mutator, so parsing does not wait behind writes (D2)
app.method('setup-parse-file', parseSetupFile);
app.method('setup-create', mutator(undoable(createFromSetup)));

async function parseSetupFile({
  name,
  bytes,
  options,
}: {
  name: string;
  bytes: Uint8Array;
  options?: ParseFileOptions;
}): Promise<ParseFileResult> {
  return parseFileContents(name, bytes, options);
}

async function createFromSetup(
  input: SetupCreateInput,
): Promise<SetupCreateResult> {
  let plan: CreatePlan;
  try {
    plan = await planCreate(input);
  } catch (error) {
    if (!(error instanceof SetupValidationError)) {
      logger.error('Bank file setup: could not plan the accounts', error);
    }
    return { ok: false, error: errorMessage(error) };
  }

  const accountIds = input.accounts.map(
    draft => plan.accountIdByDraftId[draft.id],
  );
  try {
    await writePlan(plan);
  } catch (error) {
    // Undo recording, budget triggers and sync listeners run after the
    // batch's SQLite transaction commits, and can still throw. Once the
    // rows exist, reporting a failure would invite a second Create.
    if (await isWritten(accountIds[0])) {
      logger.error(
        'Bank file setup: accounts were created, but a step after the write failed',
        error,
      );
      return {
        ok: true,
        accountIds,
        transactionCount: plan.transactionCount,
        warning: errorMessage(error),
      };
    }
    logger.error('Bank file setup: nothing was created', error);
    return { ok: false, error: errorMessage(error) };
  }

  return { ok: true, accountIds, transactionCount: plan.transactionCount };
}

// Step 2 of Create (D6): one batch of raw inserts, none of which reads the
// database. Each insert finishes before the next starts, so a throw leaves
// no insert half done to send a message after the batch is discarded.
async function writePlan(plan: CreatePlan): Promise<void> {
  await batchMessages(async () => {
    for (const account of plan.accounts) {
      await db.insertWithUUID('accounts', account);
    }
    for (const payee of plan.payees) {
      // Writes the payee and its payee_mapping row; its batch joins this one
      await db.insertPayee(payee);
    }
    for (const transaction of plan.transactions) {
      await db.insertTransaction(transaction);
    }
  });
}

async function isWritten(accountId: string): Promise<boolean> {
  const row = await db.first<Pick<db.DbAccount, 'id'>>(
    'SELECT id FROM accounts WHERE id = ?',
    [accountId],
  );
  return row !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
