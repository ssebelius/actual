import React from 'react';
import { useTranslation } from 'react-i18next';

import { SpaceBetween } from '@actual-app/components/space-between';
import { View } from '@actual-app/components/view';

import { SectionLabel } from '#components/forms';

import { SelectField } from './SelectField';
import { SubLabel } from './SubLabel';
import { stripCsvImportTransaction } from './utils';
import type { FieldMapping, ImportTransaction } from './utils';

type FieldMappingsProps = {
  transactions: Array<Partial<ImportTransaction>>;
  mappings?: FieldMapping;
  onChange: (field: keyof FieldMapping, newValue: string) => void;
  splitMode: boolean;
  inOutMode: boolean;
  hasHeaderRow: boolean;
  /** Offer a Balance column (bank file setup only) */
  showBalance?: boolean;
  /** The setup flow does not import categories */
  showCategory?: boolean;
};

export function FieldMappings({
  transactions,
  mappings = {
    date: null,
    amount: null,
    payee: null,
    notes: null,
    inOut: null,
    category: null,
    outflow: null,
    inflow: null,
    balance: null,
  },
  onChange,
  splitMode,
  inOutMode,
  hasHeaderRow,
  showBalance = false,
  showCategory = true,
}: FieldMappingsProps) {
  const { t } = useTranslation();
  if (transactions.length === 0) {
    return null;
  }

  const trans = stripCsvImportTransaction(transactions[0]);
  const options = Object.keys(trans);
  const shared = {
    options,
    mappings,
    onChange,
    hasHeaderRow,
    firstTransaction: transactions[0],
  };

  return (
    <View>
      <SectionLabel title={t('CSV FIELDS')} />
      <SpaceBetween gap={10} style={{ marginTop: 5, alignItems: 'flex-start' }}>
        <Picker {...shared} field="date" label={t('Date')} />
        <Picker {...shared} field="payee" label={t('Payee')} />
        <Picker {...shared} field="notes" label={t('Notes')} />
        {showCategory && (
          <Picker {...shared} field="category" label={t('Category')} />
        )}
        {splitMode && !inOutMode ? (
          <>
            <Picker
              {...shared}
              field="outflow"
              label={t('Outflow')}
              flex={0.5}
            />
            <Picker {...shared} field="inflow" label={t('Inflow')} flex={0.5} />
          </>
        ) : (
          <>
            {inOutMode && (
              <Picker {...shared} field="inOut" label={t('In/Out')} />
            )}
            <Picker {...shared} field="amount" label={t('Amount')} />
          </>
        )}
        {showBalance && (
          <Picker {...shared} field="balance" label={t('Balance')} />
        )}
      </SpaceBetween>
    </View>
  );
}

type PickerProps = {
  field: keyof FieldMapping;
  label: string;
  flex?: number;
  options: string[];
  mappings: FieldMapping;
  onChange: (field: keyof FieldMapping, newValue: string) => void;
  hasHeaderRow: boolean;
  firstTransaction: Partial<ImportTransaction>;
};

function Picker({
  field,
  label,
  flex = 1,
  options,
  mappings,
  onChange,
  hasHeaderRow,
  firstTransaction,
}: PickerProps) {
  return (
    <View style={{ flex }}>
      <SubLabel title={label} />
      <SelectField
        aria-label={label}
        options={options}
        value={mappings[field] ?? null}
        onChange={name => onChange(field, name)}
        hasHeaderRow={hasHeaderRow}
        firstTransaction={firstTransaction}
      />
    </View>
  );
}
