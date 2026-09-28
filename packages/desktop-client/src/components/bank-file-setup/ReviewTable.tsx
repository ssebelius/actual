import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type {
  Review,
  ReviewAccount,
  SetupAccountDraft,
  SetupAccountType,
} from '@actual-app/core/shared/bank-file-setup';
import { css } from '@emotion/css';
import type { TFunction } from 'i18next';

import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import type { UseFormatResult } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import {
  accountDisplayName,
  accountTypeLabel,
  shortDate,
} from './useSetupDraft';

type ReviewTableProps = {
  accounts: SetupAccountDraft[];
  review: Review;
  labelledBy: string;
};

export function ReviewTable({
  accounts,
  review,
  labelledBy,
}: ReviewTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <table aria-labelledby={labelledBy} className={tableClassName}>
      <thead>
        <tr>
          <th scope="col">
            <Trans>Account</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Transactions</Trans>
          </th>
          <th scope="col">
            <Trans>Dates</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Duplicates</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Starting balance</Trans>
          </th>
          <th scope="col" style={numeric}>
            <Trans>Ending balance</Trans>
          </th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account, index) => {
          const reviewed = review.accounts[index];
          if (!reviewed) {
            return null;
          }
          return (
            <ReviewRows
              key={account.id}
              account={account}
              index={index}
              reviewed={reviewed}
              isExpanded={expanded === account.id}
              onToggle={() =>
                setExpanded(expanded === account.id ? null : account.id)
              }
            />
          );
        })}
      </tbody>
    </table>
  );
}

export function formatBalance(
  format: UseFormatResult,
  amount: number,
  type: SetupAccountType,
  t: TFunction,
): string {
  if (type === 'credit' && amount <= 0) {
    return t('{{amount}} owed', {
      amount: format(Math.abs(amount), 'financial'),
    });
  }
  return format(amount, 'financial');
}

type ReviewRowsProps = {
  account: SetupAccountDraft;
  index: number;
  reviewed: ReviewAccount;
  isExpanded: boolean;
  onToggle: () => void;
};

function ReviewRows({
  account,
  index,
  reviewed,
  isExpanded,
  onToggle,
}: ReviewRowsProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const name = accountDisplayName(account, index, t);
  const detailsId = `setup-skipped-${account.id}`;
  const details = [account.bank.trim(), accountTypeLabel(account.type, t)]
    .filter(part => part !== '')
    .join(' · ');

  return (
    <>
      <tr
        style={
          reviewed.block !== null ? { color: theme.pageTextSubdued } : undefined
        }
      >
        <th scope="row" style={{ fontWeight: 400 }}>
          <div>{name}</div>
          <div style={smallSubdued}>{details}</div>
        </th>
        <td style={numeric}>
          {reviewed.block === 'needs-columns' ? (
            <>
              <span aria-hidden="true">?</span>
              <Text style={styles.visuallyHidden}>
                <Trans>Not known until the columns are mapped</Trans>
              </Text>
            </>
          ) : (
            <FinancialText>{reviewed.rows.length}</FinancialText>
          )}
        </td>
        <td>{datesText(account, reviewed, t, locale)}</td>
        <td style={numeric}>
          {reviewed.skipped.length > 0 ? (
            <Button
              variant="bare"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              style={linkStyle}
              onPress={onToggle}
            >
              {t('{{count}} skipped', { count: reviewed.skipped.length })}
            </Button>
          ) : (
            <FinancialText>0</FinancialText>
          )}
        </td>
        <td style={numeric}>
          {reviewed.starting ? (
            <>
              <FinancialText>
                {formatBalance(
                  format,
                  reviewed.starting.amount,
                  account.type,
                  t,
                )}
              </FinancialText>
              <div style={smallSubdued}>
                {shortDate(reviewed.starting.date, locale)}
              </div>
            </>
          ) : (
            <Text>
              {reviewed.block === 'needs-columns'
                ? t('Needs columns')
                : t('Needs a balance')}
            </Text>
          )}
        </td>
        <td style={numeric}>
          {reviewed.ending !== null ? (
            <FinancialText>
              {formatBalance(format, reviewed.ending, account.type, t)}
            </FinancialText>
          ) : null}
        </td>
      </tr>
      {isExpanded ? (
        <tr id={detailsId}>
          <td colSpan={6}>
            <Text style={smallSubdued}>
              {t('In more than one file for {{name}}, so imported once:', {
                name,
              })}
            </Text>
            <table className={skippedTableClassName}>
              <tbody>
                {reviewed.skipped.map(({ row }) => (
                  <tr key={row.id}>
                    <td>{shortDate(row.date, locale)}</td>
                    <td>{row.payeeName}</td>
                    <td style={numeric}>
                      <FinancialText>
                        {format(row.amount, 'financial')}
                      </FinancialText>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function datesText(
  account: SetupAccountDraft,
  reviewed: ReviewAccount,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  if (account.files.length === 0) {
    return t('No files');
  }
  if (reviewed.from === null || reviewed.to === null) {
    return t('No transactions');
  }
  return t('{{from}} to {{to}}', {
    from: shortDate(reviewed.from, locale),
    to: shortDate(reviewed.to, locale),
  });
}

const numeric = { textAlign: 'right' } satisfies CSSProperties;

const smallSubdued = {
  fontSize: 12,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

const linkStyle = {
  display: 'inline',
  padding: 0,
  color: theme.pageTextLink,
  textDecoration: 'underline',
} satisfies CSSProperties;

const tableClassName = css({
  width: '100%',
  borderCollapse: 'collapse',
  backgroundColor: theme.tableBackground,
  border: `1px solid ${theme.tableBorder}`,
  color: theme.pageText,
  fontSize: 13,
  '& th, & td': {
    padding: '8px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
    borderTop: `1px solid ${theme.tableBorder}`,
  },
  '& thead th': {
    fontWeight: 400,
    color: theme.pageTextSubdued,
    borderTop: 'none',
  },
});

const skippedTableClassName = css({
  marginTop: 4,
  borderCollapse: 'collapse',
  '& td': { padding: '2px 12px 2px 0', border: 'none' },
});
