import type { ReactNode } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

type StartChoiceProps = {
  onSetUp: () => void;
  onStartEmpty: () => void;
};

export function StartChoice({ onSetUp, onStartEmpty }: StartChoiceProps) {
  return (
    <View
      style={{
        width: '100%',
        maxWidth: 640,
        margin: '0 auto',
        padding: '64px 16px',
        gap: 16,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: 28,
          fontWeight: 600,
          color: theme.pageText,
        }}
      >
        <Trans>How do you want to start?</Trans>
      </h1>
      <ChoiceButton
        isPrimary
        title={<Trans>Set up from bank files</Trans>}
        description={
          <Trans>
            Add your accounts and the files you downloaded from your banks.
            Nothing is created until you confirm.
          </Trans>
        }
        onPress={onSetUp}
      />
      <ChoiceButton
        title={<Trans>Start with an empty budget</Trans>}
        description={
          <Trans>
            Add accounts yourself. You can still set up from bank files later.
          </Trans>
        }
        onPress={onStartEmpty}
      />
    </View>
  );
}

type ChoiceButtonProps = {
  title: ReactNode;
  description: ReactNode;
  isPrimary?: boolean;
  onPress: () => void;
};

function ChoiceButton({
  title,
  description,
  isPrimary = false,
  onPress,
}: ChoiceButtonProps) {
  return (
    <Button
      onPress={onPress}
      style={{
        justifyContent: 'flex-start',
        textAlign: 'left',
        padding: 20,
        borderRadius: 6,
        backgroundColor: theme.tableBackground,
        border: `1px solid ${isPrimary ? theme.buttonPrimaryBackground : theme.tableBorder}`,
      }}
    >
      <View style={{ gap: 4, alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 16, fontWeight: 600, color: theme.pageText }}>
          {title}
        </Text>
        <Text style={{ color: theme.pageTextSubdued, lineHeight: 1.4 }}>
          {description}
        </Text>
      </View>
    </Button>
  );
}
