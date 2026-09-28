import { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { SpaceBetween } from '@actual-app/components/space-between';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { integerToCurrency } from '@actual-app/core/shared/util';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { SectionLabel } from '#components/forms';
import { LabeledCheckbox } from '#components/forms/LabeledCheckbox';
import { DateFormatSelect } from '#components/modals/ImportTransactionsModal/DateFormatSelect';
import { FieldMappings } from '#components/modals/ImportTransactionsModal/FieldMappings';
import { InOutOption } from '#components/modals/ImportTransactionsModal/InOutOption';
import { MultiplierOption } from '#components/modals/ImportTransactionsModal/MultiplierOption';
import { isDateFormat } from '#components/modals/ImportTransactionsModal/utils';
import type {
  DateFormat,
  FieldMapping,
} from '#components/modals/ImportTransactionsModal/utils';
import type { Modal as ModalType } from '#modals/modalsSlice';

import {
  buildCsvMapping,
  csvRowRecord,
  csvToSetupRows,
  initialCsvMapping,
  toCsvRawRows,
} from './csvRows';
import type { CsvRawRow } from './csvRows';

type CsvMappingModalProps = Extract<
  ModalType,
  { name: 'bank-file-setup-csv-mapping' }
>['options'];

const PREVIEW_ROW_COUNT = 5;

/**
 * Column mapping for one CSV in the bank file setup flow. It returns a
 * mapping and nothing else: no import, and no saved settings read or
 * written (the flow writes them after Create, under the new account).
 */
export function CsvMappingModal({
  fileName,
  fileBytes,
  rawRows: initialRawRows,
  initial,
  onDone,
}: CsvMappingModalProps) {
  const { t } = useTranslation();
  const [start] = useState(
    () => initial ?? initialCsvMapping(fileName, initialRawRows),
  );
  const [rawRows, setRawRows] = useState<CsvRawRow[]>(initialRawRows);
  const [hasHeaderRow, setHasHeaderRow] = useState(start.settings.hasHeaderRow);
  const [skipStartLines, setSkipStartLines] = useState(
    start.settings.skipStartLines,
  );
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const latestParse = useRef(0);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping>(
    start.fieldMappings,
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    isDateFormat(start.dateFormat) ? start.dateFormat : 'mm dd yyyy',
  );
  const [flipAmount, setFlipAmount] = useState(start.flipAmount);
  const [splitMode, setSplitMode] = useState(
    Boolean(start.fieldMappings.outflow || start.fieldMappings.inflow),
  );
  const [inOutMode, setInOutMode] = useState(start.inOutMode);
  const [outValue, setOutValue] = useState(start.outValue);
  const [multiplierEnabled, setMultiplierEnabled] = useState(
    start.multiplier !== '',
  );
  const [multiplier, setMultiplier] = useState(start.multiplier);

  const rows = rawRows.map(csvRowRecord);
  const mapping = buildCsvMapping(
    { ...start.settings, hasHeaderRow, skipStartLines },
    {
      fieldMappings,
      dateFormat,
      flipAmount,
      multiplier: multiplierEnabled ? multiplier : '',
      inOutMode,
      outValue,
    },
  );
  const preview = csvToSetupRows(
    'preview',
    rawRows.slice(0, PREVIEW_ROW_COUNT),
    mapping,
  );
  const whole = csvToSetupRows('whole', rawRows, mapping);
  const errorCount = whole.errors.length;
  const balance = whole.balance;
  const canFinish = !isParsing && whole.rows.length > 0;

  // The columns can change, so the mapping is guessed again from the new rows
  async function reparse(
    nextHasHeaderRow: boolean,
    nextSkipStartLines: number,
  ) {
    setHasHeaderRow(nextHasHeaderRow);
    setSkipStartLines(nextSkipStartLines);
    setIsParsing(true);
    const request = ++latestParse.current;
    const result = await send('setup-parse-file', {
      name: fileName,
      bytes: fileBytes,
      options: {
        hasHeaderRow: nextHasHeaderRow,
        skipStartLines: nextSkipStartLines,
        delimiter: start.settings.delimiter,
      },
    });
    if (request !== latestParse.current) {
      return;
    }
    const nextRawRows =
      result.errors.length > 0 ? [] : toCsvRawRows(result.transactions ?? []);
    const guess = initialCsvMapping(fileName, nextRawRows);
    setRawRows(nextRawRows);
    setParseError(result.errors[0]?.message ?? null);
    setFieldMappings(guess.fieldMappings);
    setDateFormat(
      isDateFormat(guess.dateFormat) ? guess.dateFormat : 'mm dd yyyy',
    );
    setSplitMode(false);
    setIsParsing(false);
  }

  function onChangeField(field: keyof FieldMapping, name: string) {
    setFieldMappings({
      ...fieldMappings,
      [field]: name === '' || name === 'choose-field' ? null : name,
    });
  }

  function onToggleSplit() {
    const isSplit = !splitMode;
    setSplitMode(isSplit);
    setFieldMappings(
      isSplit
        ? {
            ...fieldMappings,
            amount: null,
            outflow: fieldMappings.amount,
            inflow: null,
          }
        : {
            ...fieldMappings,
            amount: fieldMappings.outflow ?? fieldMappings.inflow,
            outflow: null,
            inflow: null,
          },
    );
  }

  function onChangeMultiplier(value: string) {
    if (!value || /^\d{1,}(\.\d{0,4})?$/.test(value)) {
      setMultiplier(value);
    }
  }

  return (
    <Modal
      name="bank-file-setup-csv-mapping"
      containerProps={{ style: { width: 800 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Columns in {{fileName}}', { fileName })}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 20,
              marginBottom: 10,
            }}
          >
            <LabeledCheckbox
              id="setup_csv_has_header"
              checked={hasHeaderRow}
              onChange={() => void reparse(!hasHeaderRow, skipStartLines)}
            >
              <Trans>File has header row</Trans>
            </LabeledCheckbox>
            <label
              htmlFor="setup_csv_skip_start_lines"
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: 5,
                alignItems: 'baseline',
              }}
            >
              <Trans>Skip start lines:</Trans>
              <Input
                id="setup_csv_skip_start_lines"
                type="number"
                value={skipStartLines}
                min="0"
                step="1"
                onChangeValue={value =>
                  void reparse(hasHeaderRow, Math.abs(parseInt(value, 10) || 0))
                }
                style={{ width: 50 }}
              />
            </label>
          </View>

          <FieldMappings
            transactions={rows}
            mappings={fieldMappings}
            onChange={onChangeField}
            splitMode={splitMode}
            inOutMode={inOutMode}
            hasHeaderRow={hasHeaderRow}
            showBalance
            showCategory={false}
          />

          <SpaceBetween
            gap={20}
            style={{ marginTop: 10, alignItems: 'flex-start' }}
          >
            <DateFormatSelect
              transactions={rows}
              fieldMappings={fieldMappings}
              parseDateFormat={dateFormat}
              onChange={value => {
                if (isDateFormat(value)) {
                  setDateFormat(value);
                }
              }}
            />
            <View style={{ gap: 5 }}>
              <SectionLabel title={t('AMOUNT OPTIONS')} />
              <LabeledCheckbox
                id="setup_csv_flip"
                checked={flipAmount}
                onChange={() => setFlipAmount(!flipAmount)}
              >
                <Trans>Flip amount</Trans>
              </LabeledCheckbox>
              <MultiplierOption
                multiplierEnabled={multiplierEnabled}
                multiplierAmount={multiplier}
                onToggle={() => {
                  setMultiplierEnabled(!multiplierEnabled);
                  setMultiplier('');
                }}
                onChangeAmount={onChangeMultiplier}
              />
              <LabeledCheckbox
                id="setup_csv_split"
                checked={splitMode}
                onChange={onToggleSplit}
              >
                <Trans>Split amount into separate inflow/outflow columns</Trans>
              </LabeledCheckbox>
              <InOutOption
                inOutMode={inOutMode}
                outValue={outValue}
                onToggle={() => setInOutMode(!inOutMode)}
                onChangeText={setOutValue}
              />
            </View>
          </SpaceBetween>

          <SectionLabel title={t('PREVIEW')} style={{ marginTop: 15 }} />
          <View>
            {preview.rows.map(row => (
              <View
                key={row.id}
                data-testid="csv-preview-row"
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  padding: '4px 0',
                  borderBottom: `1px solid ${theme.tableBorder}`,
                }}
              >
                <Text style={{ width: 100 }}>{row.date}</Text>
                <Text style={{ flex: 1 }}>{row.payeeName}</Text>
                <FinancialText style={{ width: 100, textAlign: 'right' }}>
                  {integerToCurrency(row.amount)}
                </FinancialText>
              </View>
            ))}
          </View>
          {balance && (
            <Text style={{ marginTop: 5 }}>
              <Trans>Balance on {{ date: balance.date }}:</Trans>{' '}
              <FinancialText>{integerToCurrency(balance.amount)}</FinancialText>
            </Text>
          )}
          {parseError !== null ? (
            <Text style={{ marginTop: 5, color: theme.errorText }}>
              {t('The file could not be read with these options: {{message}}', {
                message: parseError,
              })}
            </Text>
          ) : whole.missing.length > 0 ? (
            <Text style={{ marginTop: 5, color: theme.errorText }}>
              {whole.missing.join(' ')}
            </Text>
          ) : errorCount > 0 ? (
            <Text style={{ marginTop: 5, color: theme.errorText }}>
              {errorCount === 1
                ? t('{{count}} row could not be read.', { count: 1 })
                : t('{{count}} rows could not be read.', {
                    count: errorCount,
                  })}{' '}
              {whole.errors[0]}
            </Text>
          ) : (
            !canFinish && (
              <Text style={{ marginTop: 5, color: theme.errorText }}>
                <Trans>There are no rows to read.</Trans>
              </Text>
            )
          )}

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 15,
            }}
          >
            <Button onPress={() => state.close()}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="primary"
              isDisabled={!canFinish}
              onPress={() => {
                onDone(mapping, rawRows);
                state.close();
              }}
            >
              <Trans>Done</Trans>
            </Button>
          </View>
        </>
      )}
    </Modal>
  );
}
