import { useId } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useAccounts } from '#hooks/useAccounts';
import { useNavigate } from '#hooks/useNavigate';

export function NoAccountsOffer() {
  const { isNarrowWidth } = useResponsive();
  const navigate = useNavigate();
  const titleId = useId();
  const { data: accounts = [], isPlaceholderData } = useAccounts();

  if (isNarrowWidth || isPlaceholderData || accounts.length > 0) {
    return null;
  }

  return (
    <View
      role="region"
      aria-labelledby={titleId}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        margin: '8px 0',
        padding: '12px 16px',
        color: theme.tableText,
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        flexShrink: 0,
      }}
    >
      <View style={{ gap: 2 }}>
        <Text id={titleId} style={{ fontSize: 15, fontWeight: 600 }}>
          <Trans>No accounts yet</Trans>
        </Text>
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            Set up this budget from the files you downloaded from your banks.
          </Trans>
        </Text>
      </View>
      <Button
        variant="primary"
        onPress={() => void navigate('/setup', { state: { skipChoice: true } })}
      >
        <Trans>Set up from bank files</Trans>
      </Button>
    </View>
  );
}
