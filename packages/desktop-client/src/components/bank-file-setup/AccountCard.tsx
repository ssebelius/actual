import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DropZone, FileTrigger, isFileDropItem } from 'react-aria-components';
import type { DropItem } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgClose } from '@actual-app/components/icons/v1';
import { SvgAlertTriangle } from '@actual-app/components/icons/v2';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type {
  ParsedStatement,
  ParseFileOptions,
  ParseFileResult,
} from '@actual-app/core/server/transactions/import/parse-file';
import type {
  ReviewAccount,
  SetupAccountDraft,
  SetupAccountType,
  SetupFile,
  SetupRow,
} from '@actual-app/core/shared/bank-file-setup';
import { amountToInteger } from '@actual-app/core/shared/util';
import { css } from '@emotion/css';
import type { TFunction } from 'i18next';
import { v4 as uuidv4 } from 'uuid';

import { Checkbox } from '#components/forms';
import { useAnnounce } from '#components/LiveRegion';
import { defaultImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { toCsvRawRows } from './csvRows';
import {
  accountDisplayName,
  accountTypeLabel,
  longDate,
  shortDate,
  transactionsText,
} from './useSetupDraft';
import type { RawCsvRows, SetupAction, SetupState } from './useSetupDraft';

type AccountCardProps = {
  account: SetupAccountDraft;
  index: number;
  review: ReviewAccount | undefined;
  rawCsv: SetupState['rawCsv'];
  fileErrors: SetupState['fileErrors'];
  findFileOwner: (hash: string) => string | null;
  onAction: (action: SetupAction) => void;
  onMapColumns: (file: SetupFile) => void;
};

export function AccountCard({
  account,
  index,
  review,
  rawCsv,
  fileErrors,
  findFileOwner,
  onAction,
  onMapColumns,
}: AccountCardProps) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const locale = useLocale();
  const [notices, setNotices] = useState<
    Array<{ id: string; name: string; message: string }>
  >([]);

  const id = account.id;
  const headingId = `setup-card-${id}`;
  const displayName = accountDisplayName(account, index, t);
  const typeOptions = (['checking', 'savings', 'credit', 'other'] as const).map(
    type => [type, accountTypeLabel(type, t)] as const,
  );

  const block = review?.block ?? null;
  const balanceBlock =
    block !== null && block !== 'needs-columns' ? block : null;
  const enteredKnown =
    review?.known?.source === 'entered' ? review.known : null;
  const questionDate = balanceBlock
    ? balanceBlock.kind === 'ledger-after-end'
      ? balanceBlock.end
      : balanceBlock.asOf
    : (enteredKnown?.date ?? null);
  const unmapped = account.files.filter(file => file.needsMapping);

  function notify(name: string, message: string) {
    setNotices(current => [...current, { id: uuidv4(), name, message }]);
    announce(message);
  }

  async function addFiles(files: File[]) {
    const seen = new Set<string>();
    let isFilled = account.files.length > 0;

    for (const file of files) {
      const fileFormat = formatOf(file.name);
      if (fileFormat === null) {
        notify(
          file.name,
          t(
            '{{name}} is not a file Actual can read. Use OFX, QFX, QBO, QIF, CSV, TSV or CAMT.053 XML.',
            { name: file.name },
          ),
        );
        continue;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      const owner = seen.has(hash) ? displayName : findFileOwner(hash);
      if (owner !== null) {
        notify(
          file.name,
          t('{{name}} was already added to {{account}}.', {
            name: file.name,
            account: owner,
          }),
        );
        continue;
      }
      seen.add(hash);

      const result = await send('setup-parse-file', {
        name: file.name,
        bytes,
        options: parseOptions(fileFormat, file.name),
      });
      const statements = result.statements ?? [];
      const isOfxFamily =
        fileFormat === 'ofx' || fileFormat === 'qfx' || fileFormat === 'qbo';

      // An OFX file's own errors repeat its statements' row errors, which
      // the statements carry; they are fatal only when no statement came back
      if (result.errors.length > 0 && !(isOfxFamily && statements.length > 0)) {
        notify(
          file.name,
          t('{{name}} could not be read: {{message}}', {
            name: file.name,
            message: result.errors[0].message,
          }),
        );
        continue;
      }

      if (isOfxFamily) {
        isFilled = addStatements(
          file.name,
          fileFormat,
          hash,
          statements,
          isFilled,
        );
      } else if (fileFormat === 'xml') {
        const rows = camtRows(hash, result.transactions ?? []);
        onAction({
          type: 'add-file',
          draftId: id,
          file: {
            id: hash,
            name: file.name,
            format: fileFormat,
            rows,
            statement: null,
            csvBalance: null,
            needsMapping: false,
          },
        });
        announce(
          t('{{name}}: {{transactions}} found.', {
            name: file.name,
            transactions: transactionsText(rows.length, t),
          }),
        );
      } else {
        const raw = toCsvRawRows(result.transactions ?? []);
        onAction({
          type: 'add-file',
          draftId: id,
          file: {
            id: hash,
            name: file.name,
            format: fileFormat,
            rows: [],
            statement: null,
            csvBalance: null,
            needsMapping: true,
          },
          rawCsv: raw,
          csvBytes: bytes,
        });
        announce(
          raw.length === 1
            ? t('{{name}}: {{count}} row found. Needs columns.', {
                name: file.name,
                count: raw.length,
              })
            : t('{{name}}: {{count}} rows found. Needs columns.', {
                name: file.name,
                count: raw.length,
              }),
        );
      }
    }
  }

  function addStatements(
    name: string,
    fileFormat: 'ofx' | 'qfx' | 'qbo',
    hash: string,
    statements: ParsedStatement[],
    isFilled: boolean,
  ): boolean {
    const usable = statements.filter(
      statement => statement.kind !== 'investment',
    );
    const investment = statements.length - usable.length;
    if (investment > 0) {
      notify(
        name,
        t(
          '{{name}} has an investment statement. Investment accounts are not supported, so it was left out.',
          { name },
        ),
      );
    }
    if (usable.length === 0) {
      if (investment === 0) {
        notify(name, t('{{name}} has no statements to import.', { name }));
      }
      return isFilled;
    }

    let filled = isFilled;
    for (const [position, statement] of usable.entries()) {
      const fileId = usable.length === 1 ? hash : `${hash}#${position}`;
      const setupFile = statementFile(fileId, name, fileFormat, statement);
      const errors = statement.errors.map(error => error.message);
      const suggestion = suggestAccount(statement, t);

      if (position === 0) {
        onAction({ type: 'add-file', draftId: id, file: setupFile, errors });
        if (!filled) {
          onAction({
            type: 'edit-account',
            draftId: id,
            patch: {
              bank: account.bank.trim() !== '' ? account.bank : suggestion.bank,
              name: account.name.trim() !== '' ? account.name : suggestion.name,
              type: suggestion.type,
            },
          });
          filled = true;
        }
      } else {
        const draftId = uuidv4();
        onAction({ type: 'add-account', draftId });
        onAction({ type: 'add-file', draftId, file: setupFile, errors });
        onAction({ type: 'edit-account', draftId, patch: suggestion });
      }
    }

    announce(
      usable.length === 1
        ? statementSummary(name, usable[0], t, locale)
        : t('{{name}} holds {{count}} accounts. Each has its own card.', {
            name,
            count: usable.length,
          }),
    );
    return filled;
  }

  async function dropFiles(items: DropItem[]) {
    const files = await Promise.all(
      items.filter(isFileDropItem).map(item => item.getFile()),
    );
    await addFiles(files);
  }

  return (
    <View
      role="group"
      aria-labelledby={headingId}
      data-testid="setup-account-card"
      style={cardStyle}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h2 id={headingId} tabIndex={-1} style={cardHeadingStyle}>
          {displayName}
        </h2>
        <Button
          variant="bare"
          onPress={() => onAction({ type: 'remove-account', draftId: id })}
        >
          <Trans>Remove</Trans>{' '}
          <Text style={styles.visuallyHidden}>{displayName}</Text>
        </Button>
      </View>

      <View
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.4fr 1fr',
          gap: 10,
        }}
      >
        <Field label={t('Bank')} htmlFor={`setup-bank-${id}`}>
          <Input
            id={`setup-bank-${id}`}
            value={account.bank}
            onChangeValue={bank =>
              onAction({ type: 'edit-account', draftId: id, patch: { bank } })
            }
          />
        </Field>
        <Field label={t('Account name')} htmlFor={`setup-name-${id}`}>
          <Input
            id={`setup-name-${id}`}
            value={account.name}
            onChangeValue={name =>
              onAction({ type: 'edit-account', draftId: id, patch: { name } })
            }
          />
        </Field>
        <Field label={t('Type')} htmlFor={`setup-type-${id}`}>
          <Select
            id={`setup-type-${id}`}
            value={account.type}
            options={typeOptions}
            onChange={type =>
              onAction({ type: 'edit-account', draftId: id, patch: { type } })
            }
          />
        </Field>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Checkbox
          id={`setup-onbudget-${id}`}
          checked={!account.offbudget}
          onChange={event =>
            onAction({
              type: 'edit-account',
              draftId: id,
              patch: { offbudget: !event.currentTarget.checked },
            })
          }
        />
        <label htmlFor={`setup-onbudget-${id}`}>
          <Trans>On budget</Trans>
        </label>
      </View>

      {account.files.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            No files. This account is created with the balance you enter and no
            history.
          </Trans>
        </Text>
      ) : null}

      {account.files.map(file => {
        const errors = fileErrors[file.id] ?? [];
        return (
          <View
            key={file.id}
            style={errors.length > 0 ? { ...goldStyle, gap: 4 } : chipStyle}
          >
            {errors.length > 0 ? (
              <GoldFlag label={t('Fix or remove this file')} />
            ) : null}
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Text style={badgeStyle}>{file.format.toUpperCase()}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text>{file.name}</Text>
                <Text style={smallSubdued}>
                  {fileNote(file, review, rawCsv, t, locale)}
                </Text>
              </View>
              <Button
                id={`setup-remove-file-${file.id}`}
                variant="bare"
                aria-label={t('Remove {{name}}', { name: file.name })}
                onPress={() => {
                  onAction({
                    type: 'remove-file',
                    draftId: id,
                    fileId: file.id,
                  });
                  announce(t('{{name}} removed.', { name: file.name }));
                }}
              >
                <SvgClose style={{ width: 8, height: 8 }} />
              </Button>
            </View>
            {errors.length > 0 ? (
              <Text>
                {errors.length === 1
                  ? t('{{count}} row could not be read: {{message}}', {
                      count: 1,
                      message: errors[0],
                    })
                  : t(
                      '{{count}} rows could not be read. The first: {{message}}',
                      { count: errors.length, message: errors[0] },
                    )}
              </Text>
            ) : null}
          </View>
        );
      })}

      {notices.map(notice => (
        <View key={notice.id} style={chipStyle}>
          <Text style={{ flex: 1 }}>{notice.message}</Text>
          <Button
            variant="bare"
            aria-label={t('Remove the message about {{name}}', {
              name: notice.name,
            })}
            onPress={() =>
              setNotices(current =>
                current.filter(item => item.id !== notice.id),
              )
            }
          >
            <SvgClose style={{ width: 8, height: 8 }} />
          </Button>
        </View>
      ))}

      <DropZone
        aria-label={t('Drop files for {{name}}', { name: displayName })}
        onDrop={event => void dropFiles(event.items)}
        className={({ isDropTarget }) =>
          css({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: 10,
            borderRadius: 4,
            border: `1px dashed ${isDropTarget ? theme.buttonPrimaryBackground : theme.tableBorder}`,
            color: theme.pageTextSubdued,
          })
        }
      >
        <FileTrigger
          allowsMultiple
          acceptedFileTypes={FILE_FORMATS.map(format => `.${format}`)}
          onSelect={list => {
            if (list) {
              void addFiles(Array.from(list));
            }
          }}
        >
          <Button
            id={`setup-add-files-${id}`}
            variant="bare"
            style={{
              padding: 2,
              color: theme.pageTextLink,
              textDecoration: 'underline',
            }}
          >
            <Trans>Add files</Trans>{' '}
            <Text style={styles.visuallyHidden}>
              {t('for {{name}}', { name: displayName })}
            </Text>
          </Button>
        </FileTrigger>
        <Text>
          <Trans>or drop them here</Trans>
        </Text>
      </DropZone>

      {unmapped.length > 0 ? (
        <View style={goldStyle}>
          <GoldFlag label={t('Needs columns')} />
          {unmapped.map(file => (
            <View key={file.id} style={{ gap: 6 }}>
              <Text>
                {t(
                  'Tell Actual which columns in {{name}} hold the date, description and amount.',
                  { name: file.name },
                )}
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <Button
                  id={`setup-map-${file.id}`}
                  onPress={() => onMapColumns(file)}
                >
                  <Trans>Map columns</Trans>{' '}
                  <Text style={styles.visuallyHidden}>
                    {t('for {{name}}', { name: file.name })}
                  </Text>
                </Button>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {balanceBlock !== null || enteredKnown !== null ? (
        <BalanceQuestion
          inputId={`setup-balance-${id}`}
          question={balanceQuestion(account, questionDate, t, locale)}
          help={
            account.files.length === 0
              ? t('The account starts with this balance.')
              : t(
                  "Use the balance on your statement or in your bank's app for that day. Pending transactions are not in your downloaded file.",
                )
          }
          ledgerNote={
            balanceBlock?.kind === 'ledger-after-end'
              ? t(
                  "This file's balance is dated {{ledgerDate}}, after its last transaction on {{end}}. Activity in between is missing, so enter the balance on {{end}}.",
                  {
                    ledgerDate: longDate(balanceBlock.ledgerDate, locale),
                    end: longDate(balanceBlock.end, locale),
                  },
                )
              : null
          }
          needsBalance={balanceBlock !== null}
          isCredit={account.type === 'credit'}
          entered={account.entered}
          onCommit={entered =>
            onAction({ type: 'edit-account', draftId: id, patch: { entered } })
          }
        />
      ) : null}
    </View>
  );
}

type BalanceQuestionProps = {
  inputId: string;
  question: string;
  help: string;
  ledgerNote: string | null;
  needsBalance: boolean;
  isCredit: boolean;
  entered: number | null;
  onCommit: (entered: number | null) => void;
};

function BalanceQuestion({
  inputId,
  question,
  help,
  ledgerNote,
  needsBalance,
  isCredit,
  entered,
  onCommit,
}: BalanceQuestionProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const [text, setText] = useState(
    entered === null ? '' : format.forEdit(entered),
  );

  function commit(value: string) {
    const next = value.trim() === '' ? null : format.fromEdit(value, null);
    if (next !== entered) {
      onCommit(next);
    }
  }

  // Same children in the same slots in both states, so the input is never
  // remounted and keeps focus while the review updates
  return (
    <View style={needsBalance ? goldStyle : { gap: 6 }}>
      {needsBalance ? <GoldFlag label={t('Needs a balance')} /> : null}
      {ledgerNote !== null ? <Text>{ledgerNote}</Text> : null}
      <label
        htmlFor={inputId}
        style={
          needsBalance
            ? { fontWeight: 500 }
            : { fontSize: 12, color: theme.pageTextSubdued }
        }
      >
        {question}
      </label>
      {needsBalance ? (
        <Text style={{ color: theme.pageTextSubdued }}>{help}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Input
          id={inputId}
          inputMode="decimal"
          value={text}
          onChangeValue={setText}
          onEnter={commit}
          onUpdate={commit}
          style={{ width: 140, textAlign: 'right' }}
        />
        {isCredit ? (
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>owed</Trans>
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function GoldFlag({ label }: { label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        fontWeight: 600,
      }}
    >
      <SvgAlertTriangle
        aria-hidden="true"
        style={{
          width: 13,
          height: 13,
          color: theme.warningText,
          flexShrink: 0,
        }}
      />
      <Text>{label}</Text>
    </View>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 4 }}>
      <label htmlFor={htmlFor} style={smallSubdued}>
        {label}
      </label>
      {children}
    </View>
  );
}

const FILE_FORMATS = [
  'ofx',
  'qfx',
  'qbo',
  'qif',
  'csv',
  'tsv',
  'xml',
] as const satisfies ReadonlyArray<SetupFile['format']>;

type ParsedTransactions = NonNullable<ParseFileResult['transactions']>;

function formatOf(name: string): SetupFile['format'] | null {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return FILE_FORMATS.find(format => format === extension) ?? null;
}

function parseOptions(
  format: SetupFile['format'],
  fileName: string,
): ParseFileOptions {
  switch (format) {
    case 'csv':
    case 'tsv':
      return {
        hasHeaderRow: true,
        delimiter: defaultImportSettings(fileName).delimiter,
      };
    case 'qif':
    case 'xml':
      return { importNotes: true };
    case 'ofx':
    case 'qfx':
    case 'qbo':
      return { importNotes: true, fallbackMissingPayeeToMemo: true };
    default:
      format satisfies never;
      throw new Error(`Unknown file format: ${String(format)}`);
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function statementFile(
  fileId: string,
  name: string,
  format: 'ofx' | 'qfx' | 'qbo',
  statement: ParsedStatement,
): SetupFile {
  return {
    id: fileId,
    name,
    format,
    rows: statement.transactions.map((trans, index) => ({
      id: `${fileId}:${index}`,
      fileId,
      date: trans.date,
      amount: amountToInteger(trans.amount),
      payeeName: trans.payee_name ?? '',
      importedPayee: trans.imported_payee ?? '',
      notes: trans.notes || null,
      importedId:
        'imported_id' in trans && typeof trans.imported_id === 'string'
          ? trans.imported_id
          : null,
    })),
    statement: {
      org: statement.org,
      accountId: statement.accountId,
      accountType: statement.accountType,
      start: statement.start,
      end: statement.end,
      ledgerBalance:
        statement.ledgerBalance === null
          ? null
          : amountToInteger(statement.ledgerBalance),
      ledgerDate: statement.ledgerDate,
    },
    csvBalance: null,
    needsMapping: false,
  };
}

function camtRows(
  fileId: string,
  transactions: ParsedTransactions,
): SetupRow[] {
  return transactions.flatMap((trans, index): SetupRow[] => {
    if (Array.isArray(trans)) {
      return [];
    }
    const amount = Number(trans.amount);
    const date = String(trans.date ?? '');
    if (!Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return [];
    }
    const payeeName = String(trans.payee_name ?? '');
    return [
      {
        id: `${fileId}:${index}`,
        fileId,
        date,
        amount: amountToInteger(amount),
        payeeName,
        importedPayee: String(trans.imported_payee ?? payeeName),
        notes: trans.notes ? String(trans.notes) : null,
        importedId:
          'imported_id' in trans && typeof trans.imported_id === 'string'
            ? trans.imported_id
            : null,
      },
    ];
  });
}

function accountTypeOf(statement: ParsedStatement): SetupAccountType {
  if (statement.kind === 'credit') {
    return 'credit';
  }
  switch ((statement.accountType ?? '').toUpperCase()) {
    case 'CHECKING':
      return 'checking';
    case 'SAVINGS':
    case 'MONEYMRKT':
      return 'savings';
    case 'CREDITLINE':
      return 'credit';
    default:
      return 'other';
  }
}

function suggestAccount(
  statement: ParsedStatement,
  t: TFunction,
): { bank: string; name: string; type: SetupAccountType } {
  const type = accountTypeOf(statement);
  const bank = statement.org ?? '';
  const kind =
    type === 'credit'
      ? t('Card')
      : type === 'savings'
        ? t('Savings')
        : type === 'checking'
          ? t('Checking')
          : '';
  const last4 = statement.accountId ? statement.accountId.slice(-4) : '';
  const base = [bank, kind].filter(part => part !== '').join(' ');
  return {
    bank,
    type,
    name: last4 !== '' ? `${base} ••${last4}`.trim() : base,
  };
}

function statementSummary(
  name: string,
  statement: ParsedStatement,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  const dates = statement.transactions.map(trans => trans.date).sort();
  if (dates.length === 0) {
    return t('{{name}}: no transactions.', { name });
  }
  return t('{{name}}: {{transactions}}, {{from}} to {{to}}.', {
    name,
    transactions: transactionsText(dates.length, t),
    from: shortDate(dates[0], locale),
    to: shortDate(dates[dates.length - 1], locale),
  });
}

function fileNote(
  file: SetupFile,
  review: ReviewAccount | undefined,
  rawCsv: Record<string, RawCsvRows>,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  if (file.needsMapping) {
    const count = rawCsv[file.id]?.length ?? 0;
    return count === 1
      ? t('{{count}} row found · columns not mapped yet', { count })
      : t('{{count}} rows found · columns not mapped yet', { count });
  }
  const parts: string[] = [];
  const dates = file.rows.map(row => row.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  if (dates.length === 0) {
    parts.push(t('No transactions'));
  } else if (from === to) {
    parts.push(
      t('{{transactions}}, {{date}}', {
        transactions: transactionsText(dates.length, t),
        date: shortDate(from, locale),
      }),
    );
  } else {
    parts.push(
      t('{{transactions}}, {{from}} to {{to}}', {
        transactions: transactionsText(dates.length, t),
        from: shortDate(from, locale),
        to: shortDate(to, locale),
      }),
    );
  }
  const skipped =
    review?.skipped.filter(skip => skip.row.fileId === file.id).length ?? 0;
  if (skipped > 0) {
    parts.push(
      skipped === 1
        ? t('{{count}} duplicate skipped', { count: skipped })
        : t('{{count}} duplicates skipped', { count: skipped }),
    );
  }
  return parts.join(' · ');
}

function balanceQuestion(
  account: SetupAccountDraft,
  date: string | null,
  t: TFunction,
  locale: ReturnType<typeof useLocale>,
): string {
  if (account.files.length === 0 || date === null) {
    return t('What is the balance today?');
  }
  const long = longDate(date, locale);
  return account.type === 'credit'
    ? t('How much did you owe on {{date}}?', { date: long })
    : t('What was the balance on {{date}}?', { date: long });
}

const cardStyle = {
  gap: 12,
  padding: 16,
  backgroundColor: theme.tableBackground,
  border: `1px solid ${theme.tableBorder}`,
  borderRadius: 6,
  color: theme.pageText,
} satisfies CSSProperties;

const cardHeadingStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: theme.pageText,
  outline: 'none',
} satisfies CSSProperties;

const chipStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  border: `1px solid ${theme.tableBorder}`,
  borderRadius: 4,
} satisfies CSSProperties;

const badgeStyle = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 6px',
  border: `1px solid ${theme.tableBorder}`,
  borderRadius: 3,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

const smallSubdued = {
  fontSize: 12,
  color: theme.pageTextSubdued,
} satisfies CSSProperties;

// Page Ink text with a gold border and icon, never gold text (UX review 5)
const goldStyle = {
  gap: 6,
  padding: '10px 14px',
  borderRadius: 4,
  border: `1px solid ${theme.warningBorder}`,
  borderLeftWidth: 4,
  backgroundColor: theme.warningBackground,
  color: theme.pageText,
} satisfies CSSProperties;
