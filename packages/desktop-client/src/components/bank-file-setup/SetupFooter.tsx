import { Fragment, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { css } from '@emotion/css';
import type { TFunction } from 'i18next';

import { accountsText, transactionsText } from './useSetupDraft';

export type SetupBlocker = {
  draftId: string;
  accountName: string;
  reason: 'name' | 'file' | 'columns' | 'balance';
  targetId: string; // the DOM id of the control that resolves it
};

export const FOOTER_REASON_ID = 'setup-footer-reason';

type SetupFooterProps = {
  accountCount: number;
  transactionCount: number;
  blockers: SetupBlocker[];
  unanswered: number;
  creating: boolean;
  error: string | null;
  onCreate: () => void;
  onFocusBlocker: (targetId: string) => void;
  onLeave: () => void;
};

export function SetupFooter({
  accountCount,
  transactionCount,
  blockers,
  unanswered,
  creating,
  error,
  onCreate,
  onFocusBlocker,
  onLeave,
}: SetupFooterProps) {
  const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);
  const isUnavailable = accountCount === 0 || blockers.length > 0 || creating;

  return (
    <View
      style={{
        gap: 10,
        padding: '12px 16px',
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
      }}
    >
      {error !== null ? (
        <Text id="setup-create-error" style={{ color: theme.errorText }}>
          <Trans>Nothing was created. Check the accounts and try again.</Trans>
        </Text>
      ) : null}
      {isConfirmingLeave ? (
        <View style={rowStyle}>
          <Text style={{ flex: 1 }}>
            <Trans>
              Leave setup? The accounts you added have not been created.
            </Trans>
          </Text>
          <Button autoFocus onPress={() => setIsConfirmingLeave(false)}>
            <Trans>Keep editing</Trans>
          </Button>
          <Button onPress={onLeave}>
            <Trans>Leave setup</Trans>
          </Button>
        </View>
      ) : null}
      <View style={rowStyle}>
        <Text id={FOOTER_REASON_ID} style={{ flex: 1, lineHeight: 1.4 }}>
          <Reason
            accountCount={accountCount}
            transactionCount={transactionCount}
            blockers={blockers}
            unanswered={unanswered}
            onFocusBlocker={onFocusBlocker}
          />
        </Text>
        <Button
          isDisabled={creating}
          onPress={() => {
            if (accountCount > 0) {
              setIsConfirmingLeave(true);
            } else {
              onLeave();
            }
          }}
        >
          <Trans>Close setup</Trans>
        </Button>
        <button
          type="button"
          aria-disabled={isUnavailable}
          aria-describedby={FOOTER_REASON_ID}
          className={createButtonClassName(isUnavailable)}
          onClick={onCreate}
        >
          {creating ? <Trans>Creating…</Trans> : <Trans>Create</Trans>}
        </button>
      </View>
    </View>
  );
}

type ReasonProps = Pick<
  SetupFooterProps,
  | 'accountCount'
  | 'transactionCount'
  | 'blockers'
  | 'unanswered'
  | 'onFocusBlocker'
>;

function Reason({
  accountCount,
  transactionCount,
  blockers,
  unanswered,
  onFocusBlocker,
}: ReasonProps) {
  const { t } = useTranslation();

  if (accountCount === 0) {
    return <Trans>Add an account before you create.</Trans>;
  }

  if (blockers.length > 0) {
    return (
      <>
        <Trans>Before you can create:</Trans>{' '}
        {blockers.map((blocker, index) => (
          <Fragment key={blocker.draftId}>
            {index > 0 ? ', ' : null}
            <Button
              variant="bare"
              style={inlineLinkStyle}
              onPress={() => onFocusBlocker(blocker.targetId)}
            >
              {blocker.accountName}
            </Button>{' '}
            {blockerText(blocker.reason, t)}
          </Fragment>
        ))}
        .
      </>
    );
  }

  return (
    <>
      {t('{{accounts}} and {{transactions}} will be created.', {
        accounts: accountsText(accountCount, t),
        transactions: transactionsText(transactionCount, t),
      })}
      {unanswered > 0 ? ` ${unansweredText(unanswered, t)}` : null}
    </>
  );
}

function blockerText(reason: SetupBlocker['reason'], t: TFunction): string {
  switch (reason) {
    case 'name':
      return t('needs a name');
    case 'file':
      return t('has a file to fix or remove');
    case 'columns':
      return t('needs columns');
    case 'balance':
      return t('needs a balance');
    default:
      reason satisfies never;
      throw new Error(`Unknown blocker: ${String(reason)}`);
  }
}

function unansweredText(count: number, t: TFunction): string {
  return count === 1
    ? t(
        '{{count}} likely transfer not answered: it will be imported as two transactions.',
        { count },
      )
    : t(
        '{{count}} likely transfers not answered: each will be imported as two transactions.',
        { count },
      );
}

function createButtonClassName(isUnavailable: boolean) {
  return css({
    ...styles.smallText,
    flexShrink: 0,
    padding: '6px 16px',
    borderRadius: 4,
    cursor: isUnavailable ? 'default' : 'pointer',
    border: `1px solid ${isUnavailable ? theme.buttonPrimaryDisabledBorder : theme.buttonPrimaryBorder}`,
    backgroundColor: isUnavailable
      ? theme.buttonPrimaryDisabledBackground
      : theme.buttonPrimaryBackground,
    color: isUnavailable
      ? theme.buttonPrimaryDisabledText
      : theme.buttonPrimaryText,
    '&:focus-visible': {
      outline: `2px solid ${theme.buttonPrimaryBackground}`,
      outlineOffset: 2,
    },
  });
}

const rowStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
} as const;

const inlineLinkStyle = {
  display: 'inline',
  padding: 0,
  color: theme.pageTextLink,
  textDecoration: 'underline',
};
