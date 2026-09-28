import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { buildReview } from '@actual-app/core/shared/bank-file-setup';
import type {
  Review,
  SetupAccountDraft,
  SetupFile,
  TransferPair,
} from '@actual-app/core/shared/bank-file-setup';
import * as monthUtils from '@actual-app/core/shared/months';
import type { TFunction } from 'i18next';
import { v4 as uuidv4 } from 'uuid';

import { LiveRegion, useAnnounce } from '#components/LiveRegion';
import { importSettingsPrefs } from '#components/modals/ImportTransactionsModal/importSettings';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useNavigate } from '#hooks/useNavigate';
import { useSyncedPrefs } from '#hooks/useSyncedPrefs';
import { pushModal } from '#modals/modalsSlice';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { AccountCard } from './AccountCard';
import { csvToSetupRows, initialCsvMapping } from './csvRows';
import { formatBalance, ReviewTable } from './ReviewTable';
import { SetupFooter } from './SetupFooter';
import type { SetupBlocker } from './SetupFooter';
import { StartChoice } from './StartChoice';
import { TransferPairs } from './TransferPairs';
import {
  accountDisplayName,
  accountsText,
  fileHash,
  pairKey,
  setupReducer,
  shortDate,
  transactionsText,
  useSetupDraft,
} from './useSetupDraft';
import type { SetupAction, SetupState } from './useSetupDraft';

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  const format = useFormat();
  const locale = useLocale();
  const skipChoice =
    (location.state as { skipChoice?: unknown } | null)?.skipChoice === true;
  const [state, setup] = useSetupDraft({ skipChoice });
  const [, saveSyncedPrefs] = useSyncedPrefs();
  const creatingRef = useRef(false);
  const pendingFocus = useRef<string[]>([]);

  useEffect(() => {
    const targets = pendingFocus.current;
    if (targets.length === 0) {
      return;
    }
    pendingFocus.current = [];
    for (const id of targets) {
      const element = document.getElementById(id);
      if (element) {
        element.focus();
        return;
      }
    }
  });

  const today = monthUtils.currentDay();
  const review = buildReview(state.accounts, today);
  const blockers = getBlockers(state.accounts, review, state.fileErrors, t);
  const unanswered = review.candidatePairs.filter(
    pair => state.answers[pairKey(pair)] === undefined,
  ).length;

  function leave() {
    void navigate('/budget');
  }

  function focusById(id: string) {
    document.getElementById(id)?.focus();
  }

  function handleAction(action: SetupAction) {
    setup(action);
    if (action.type === 'remove-account') {
      pendingFocus.current = ['setup-add-account'];
    }
    if (action.type === 'remove-file') {
      pendingFocus.current = [`setup-add-files-${action.draftId}`];
    }
    if (action.type === 'edit-account' && action.patch.entered !== undefined) {
      announceBalance(action);
    }
  }

  // UX review 2: the new starting balance is announced, not only redrawn
  function announceBalance(
    action: Extract<SetupAction, { type: 'edit-account' }>,
  ) {
    const next = setupReducer(state, action);
    const index = next.accounts.findIndex(
      account => account.id === action.draftId,
    );
    if (index < 0) {
      return;
    }
    const account = next.accounts[index];
    const reviewed = buildReview(next.accounts, today).accounts[index];
    const name = accountDisplayName(account, index, t);
    announce(
      reviewed.starting
        ? t('{{name}}: starting balance {{amount}} on {{date}}.', {
            name,
            amount: formatBalance(
              format,
              reviewed.starting.amount,
              account.type,
              t,
            ),
            date: shortDate(reviewed.starting.date, locale),
          })
        : t('{{name}} needs a balance.', { name }),
    );
  }

  function findFileOwner(hash: string): string | null {
    for (const [index, account] of state.accounts.entries()) {
      if (account.files.some(file => fileHash(file.id) === hash)) {
        return accountDisplayName(account, index, t);
      }
    }
    return null;
  }

  function openMapping(draftId: string, file: SetupFile) {
    const rawRows = state.rawCsv[file.id] ?? [];
    dispatch(
      pushModal({
        modal: {
          name: 'bank-file-setup-csv-mapping',
          options: {
            fileName: file.name,
            fileBytes: state.csvBytes[file.id],
            rawRows,
            initial:
              state.mappings[file.id] ?? initialCsvMapping(file.name, rawRows),
            onDone: (mapping, mappedRawRows) => {
              const { rows, balance, errors } = csvToSetupRows(
                file.id,
                mappedRawRows,
                mapping,
              );
              setup({
                type: 'map-csv',
                fileId: file.id,
                mapping,
                rawCsv: mappedRawRows,
                rows,
                balance,
                // The rows that did parse stay, and the file blocks Create
                // until it is remapped cleanly or removed
                errors,
              });
              pendingFocus.current = [
                `setup-balance-${draftId}`,
                `setup-card-${draftId}`,
              ];
              const mapped = t(
                'Columns mapped for {{name}}: {{transactions}}.',
                {
                  name: file.name,
                  transactions: transactionsText(rows.length, t),
                },
              );
              announce(
                errors.length === 0
                  ? mapped
                  : `${mapped} ${
                      errors.length === 1
                        ? t('{{count}} row could not be read.', { count: 1 })
                        : t('{{count}} rows could not be read.', {
                            count: errors.length,
                          })
                    }`,
              );
            },
          },
        },
      }),
    );
  }

  function answerPair(
    pair: TransferPair,
    answer: 'confirmed' | 'separate' | null,
  ) {
    setup({ type: 'answer-pair', pair, answer });
    const key = pairKey(pair);
    pendingFocus.current =
      answer === null
        ? [`setup-pair-confirm-${key}`]
        : [`setup-pair-change-${key}`];
    announce(
      answer === 'confirmed'
        ? t('Transfer confirmed.')
        : answer === 'separate'
          ? t('Kept as two transactions.')
          : t('Answer cleared.'),
    );
  }

  async function create() {
    // Review Focus 4: nothing is sent while a Create is in flight
    if (creatingRef.current) {
      return;
    }
    if (state.accounts.length === 0) {
      focusById('setup-add-account');
      return;
    }
    if (blockers.length > 0) {
      focusById(blockers[0].targetId);
      return;
    }

    creatingRef.current = true;
    setup({ type: 'create-start' });
    const confirmedPairs = review.candidatePairs.filter(
      pair => state.answers[pairKey(pair)] === 'confirmed',
    );
    const result = await send('setup-create', {
      accounts: state.accounts,
      confirmedPairs,
      today,
    }).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : JSON.stringify(error),
    }));

    // The server's messages are English and technical: log them, and show
    // the page's own translated text
    // Narrowed with 'in': this package compiles without strictNullChecks,
    // where `ok: false` does not narrow the union
    if ('error' in result) {
      console.error('Bank file setup failed:', result.error);
      creatingRef.current = false;
      setup({ type: 'create-failed', error: result.error });
      announce(t('Nothing was created. Check the accounts and try again.'));
      return;
    }

    // Save the column mappings so a later import into these accounts is
    // already set up. Create has committed; a failure here changes nothing else.
    try {
      const prefs: Record<string, string> = {};
      state.accounts.forEach((account, index) => {
        const accountId = result.accountIds[index];
        for (const file of account.files) {
          const mapping = state.mappings[file.id];
          if (accountId && mapping) {
            Object.assign(
              prefs,
              importSettingsPrefs(accountId, file.format, mapping.settings),
            );
          }
        }
      });
      if (Object.keys(prefs).length > 0) {
        saveSyncedPrefs(prefs);
      }
    } catch (error) {
      console.error('Bank file setup: saving import settings failed', error);
    }

    const summary = t(
      'Created {{accounts}} and {{transactions}}. They are uncategorized; start with the ones below. Past months will look overspent because nothing was budgeted in them.',
      {
        accounts: accountsText(result.accountIds.length, t),
        transactions: transactionsText(result.transactionCount, t),
      },
    );
    announce(summary);
    dispatch(
      addNotification({ notification: { type: 'message', message: summary } }),
    );
    // Everything is committed; a failure after the commit is only reported
    if (result.warning) {
      console.error('Bank file setup warning:', result.warning);
      dispatch(
        addNotification({
          notification: {
            type: 'warning',
            message: t(
              'Everything was created, but a step after saving did not finish. Your accounts and transactions are safe.',
            ),
          },
        }),
      );
    }
    void navigate('/categories/uncategorized');
  }

  if (state.step === 'choice') {
    return (
      <View style={pageStyle}>
        <LiveRegion />
        <StartChoice
          onSetUp={() => {
            setup({ type: 'choose-setup', draftId: uuidv4() });
            pendingFocus.current = ['setup-title'];
          }}
          onStartEmpty={leave}
        />
      </View>
    );
  }

  return (
    <View style={pageStyle} data-testid="bank-file-setup-page">
      <LiveRegion />
      <View style={columnStyle}>
        <fieldset disabled={state.creating} style={fieldsetStyle}>
          <View style={{ gap: 4 }}>
            <h1 id="setup-title" tabIndex={-1} style={titleStyle}>
              <Trans>Your accounts</Trans>
            </h1>
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>
                Add each bank account, then the files you downloaded for it.
                Nothing is created until you click Create.
              </Trans>
            </Text>
          </View>

          {state.accounts.map((account, index) => (
            <AccountCard
              key={account.id}
              account={account}
              index={index}
              review={review.accounts[index]}
              rawCsv={state.rawCsv}
              fileErrors={state.fileErrors}
              findFileOwner={findFileOwner}
              onAction={handleAction}
              onMapColumns={file => openMapping(account.id, file)}
            />
          ))}

          <View style={{ flexDirection: 'row' }}>
            <Button
              id="setup-add-account"
              onPress={() => {
                const draftId = uuidv4();
                setup({ type: 'add-account', draftId });
                pendingFocus.current = [`setup-bank-${draftId}`];
              }}
            >
              <Trans>Add account</Trans>
            </Button>
          </View>

          <View style={{ gap: 8 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}
            >
              <h2 id="setup-review-heading" style={sectionHeadingStyle}>
                <Trans>What will be created</Trans>
              </h2>
              <Text style={{ fontSize: 12, color: theme.pageTextSubdued }}>
                <Trans>Updates as you edit</Trans>
              </Text>
            </View>
            <ReviewTable
              accounts={state.accounts}
              review={review}
              labelledBy="setup-review-heading"
            />
          </View>

          {review.candidatePairs.length > 0 ? (
            <TransferPairs
              pairs={review.candidatePairs}
              answers={state.answers}
              accounts={state.accounts}
              review={review}
              onAnswer={answerPair}
            />
          ) : null}
        </fieldset>

        <SetupFooter
          accountCount={state.accounts.length}
          transactionCount={review.transactionCount}
          blockers={blockers}
          unanswered={unanswered}
          creating={state.creating}
          error={state.error}
          onCreate={() => void create()}
          onFocusBlocker={focusById}
          onLeave={leave}
        />
      </View>
    </View>
  );
}

// One blocker per account, in the order a person fixes them: the name, a
// file with unreadable rows, the columns, then the balance
function getBlockers(
  accounts: SetupAccountDraft[],
  review: Review,
  fileErrors: SetupState['fileErrors'],
  t: TFunction,
): SetupBlocker[] {
  return accounts.flatMap((account, index): SetupBlocker[] => {
    const accountName = accountDisplayName(account, index, t);
    const block = review.accounts[index]?.block ?? null;
    const unreadable = account.files.find(
      file => (fileErrors[file.id] ?? []).length > 0,
    );
    if (account.name.trim() === '') {
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'name',
          targetId: `setup-name-${account.id}`,
        },
      ];
    }
    if (unreadable) {
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'file',
          targetId: `setup-remove-file-${unreadable.id}`,
        },
      ];
    }
    if (block === 'needs-columns') {
      const unmapped = account.files.find(file => file.needsMapping);
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'columns',
          targetId: unmapped
            ? `setup-map-${unmapped.id}`
            : `setup-add-files-${account.id}`,
        },
      ];
    }
    if (block !== null) {
      return [
        {
          draftId: account.id,
          accountName,
          reason: 'balance',
          targetId: `setup-balance-${account.id}`,
        },
      ];
    }
    return [];
  });
}

const pageStyle = {
  flex: 1,
  overflowY: 'auto',
  backgroundColor: theme.pageBackground,
} satisfies CSSProperties;

const columnStyle = {
  width: '100%',
  maxWidth: 720,
  margin: '0 auto',
  padding: '32px 16px 64px',
  gap: 16,
} satisfies CSSProperties;

const fieldsetStyle = {
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
} satisfies CSSProperties;

const titleStyle = {
  margin: 0,
  fontSize: 24,
  fontWeight: 600,
  color: theme.pageText,
  outline: 'none',
} satisfies CSSProperties;

const sectionHeadingStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: theme.pageText,
} satisfies CSSProperties;
