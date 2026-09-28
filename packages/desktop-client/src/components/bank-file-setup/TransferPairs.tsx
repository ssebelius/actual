import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  Review,
  SetupAccountDraft,
  SetupRow,
  TransferPair,
} from '@actual-app/core/shared/bank-file-setup';
import { css } from '@emotion/css';

import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { accountDisplayName, pairKey, shortDate } from './useSetupDraft';
import type { SetupState } from './useSetupDraft';

type TransferPairsProps = {
  pairs: TransferPair[];
  answers: SetupState['answers'];
  accounts: SetupAccountDraft[];
  review: Review;
  onAnswer: (
    pair: TransferPair,
    answer: 'confirmed' | 'separate' | null,
  ) => void;
};

export function TransferPairs({
  pairs,
  answers,
  accounts,
  review,
  onAnswer,
}: TransferPairsProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();

  const rowsById = new Map<string, { draftId: string; row: SetupRow }>();
  for (const reviewed of review.accounts) {
    for (const row of reviewed.rows) {
      rowsById.set(row.id, { draftId: reviewed.draftId, row });
    }
  }

  function nameOf(draftId: string) {
    const index = accounts.findIndex(account => account.id === draftId);
    return index < 0 ? '' : accountDisplayName(accounts[index], index, t);
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <h2 id="setup-transfers-heading" style={headingStyle}>
          <Trans>Likely transfers</Trans>
        </h2>
        <Text style={smallSubdued}>
          {pairs.length === 1
            ? t('{{count}} pair', { count: 1 })
            : t('{{count}} pairs', { count: pairs.length })}
        </Text>
      </View>
      <View
        style={{
          gap: 10,
          padding: 16,
          backgroundColor: theme.tableBackground,
          border: `1px solid ${theme.tableBorder}`,
          borderRadius: 6,
        }}
      >
        <Text style={{ color: theme.pageTextSubdued, lineHeight: 1.4 }}>
          <Trans>
            The same amount leaving one of your accounts and arriving in
            another. A confirmed pair becomes a transfer, so it is not counted
            as spending and income.
          </Trans>
        </Text>
        <table
          aria-labelledby="setup-transfers-heading"
          className={tableClassName}
        >
          <thead>
            <tr>
              <th scope="col" style={numeric}>
                <Trans>Amount</Trans>
              </th>
              <th scope="col">
                <Trans>From</Trans>
              </th>
              <th scope="col">
                <Trans>To</Trans>
              </th>
              <th scope="col">
                <Trans>Dates</Trans>
              </th>
              <th scope="col">
                <Text style={styles.visuallyHidden}>
                  <Trans>Answer</Trans>
                </Text>
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(pair => {
              const out = rowsById.get(pair.outRowId);
              const into = rowsById.get(pair.inRowId);
              if (!out || !into) {
                return null;
              }
              const key = pairKey(pair);
              const answer = answers[key];
              const amount = format(Math.abs(out.row.amount), 'financial');
              const from = nameOf(out.draftId);
              const to = nameOf(into.draftId);
              const label = t('{{amount}} from {{from}} to {{to}}, {{date}}', {
                amount,
                from,
                to,
                date: shortDate(out.row.date, locale),
              });
              const dates =
                out.row.date === into.row.date
                  ? shortDate(out.row.date, locale)
                  : t('{{first}} and {{second}}', {
                      first: shortDate(out.row.date, locale),
                      second: shortDate(into.row.date, locale),
                    });

              return (
                <tr key={key}>
                  <td style={numeric}>
                    <FinancialText>{amount}</FinancialText>
                  </td>
                  <td>
                    <div>{from}</div>
                    <div style={smallSubdued}>{out.row.payeeName}</div>
                  </td>
                  <td>
                    <div>{to}</div>
                    <div style={smallSubdued}>{into.row.payeeName}</div>
                  </td>
                  <td>{dates}</td>
                  <td>
                    {answer === undefined ? (
                      <View key="ask" style={{ flexDirection: 'row', gap: 6 }}>
                        <Button
                          id={`setup-pair-confirm-${key}`}
                          onPress={() => onAnswer(pair, 'confirmed')}
                        >
                          <Trans>Confirm</Trans>{' '}
                          <Text style={styles.visuallyHidden}>
                            {t('transfer of {{label}}', { label })}
                          </Text>
                        </Button>
                        <Button onPress={() => onAnswer(pair, 'separate')}>
                          <Trans>Keep separate</Trans>
                          <Text style={styles.visuallyHidden}>
                            {': '}
                            {label}
                          </Text>
                        </Button>
                      </View>
                    ) : (
                      <View
                        key="answered"
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Text style={{ color: theme.pageTextSubdued }}>
                          {answer === 'confirmed'
                            ? t('Will be imported as a transfer.')
                            : t('Will be imported as two transactions.')}
                        </Text>
                        <Button
                          id={`setup-pair-change-${key}`}
                          variant="bare"
                          style={{
                            color: theme.pageTextLink,
                            textDecoration: 'underline',
                          }}
                          onPress={() => onAnswer(pair, null)}
                        >
                          <Trans>Change</Trans>{' '}
                          <Text style={styles.visuallyHidden}>
                            {t('answer for {{label}}', { label })}
                          </Text>
                        </Button>
                      </View>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </View>
    </View>
  );
}

const headingStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: theme.pageText,
} satisfies CSSProperties;

const numeric = { textAlign: 'right' } satisfies CSSProperties;

const smallSubdued = {
  fontSize: 12,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

const tableClassName = css({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  color: theme.pageText,
  '& th, & td': {
    padding: '6px 10px',
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
