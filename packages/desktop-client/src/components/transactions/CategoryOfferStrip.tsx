import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Popover } from '@actual-app/components/popover';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  CategoryOffer,
  CategoryOfferResult,
  CategoryOfferReviewRow,
} from '@actual-app/core/types/models';
import { format as formatDate, parseISO } from 'date-fns';
import type { TFunction } from 'i18next';

import { FinancialText } from '#components/FinancialText';
import { Checkbox } from '#components/forms';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';

export type CategoryOfferState =
  | {
      status: 'offer';
      key: number;
      offer: CategoryOffer;
      previousCategoryId: string | null;
      include: boolean;
    }
  | {
      status: 'applied';
      key: number;
      offer: CategoryOffer;
      result: CategoryOfferResult;
    };

export type CategoryOfferStripProps = {
  state: CategoryOfferState;
  payeeName: string;
  getCategoryName: (id: string) => string;
  getAccountName: (id: string) => string;
  autoFocus: boolean;
  onToggleInclude: () => void;
  onApply: (onlyIds?: string[]) => void;
  onDecline: () => void;
  onUndo: () => void;
  onViewRule: () => void;
  onDismiss: () => void;
  loadReviewRows: () => Promise<CategoryOfferReviewRow[]>;
  onHeightChange: (height: number) => void;
};

// English keys carry no plural forms, so each counted string picks its
// singular or plural key here; both keep {{count}} for translators.
export function getCategoryOfferAnnouncement(
  state: CategoryOfferState,
  names: { payee: string; category: (id: string) => string },
  t: TFunction,
) {
  const payee = names.payee;
  const category = names.category(state.offer.categoryId);
  if (state.status === 'applied') {
    const count = state.result.changedCount;
    if (count === 0) {
      return t('Saved a rule: {{payee}} → {{category}}.', {
        payee,
        category,
      });
    }
    return count === 1
      ? t(
          'Updated {{count}} transaction and saved a rule: {{payee}} → {{category}}.',
          { count, payee, category },
        )
      : t(
          'Updated {{count}} transactions and saved a rule: {{payee}} → {{category}}.',
          { count, payee, category },
        );
  }
  const count = state.offer.uncategorizedIds.length;
  if (count === 0) {
    return t('Save a rule to use {{category}} for {{payee}} from now on?', {
      payee,
      category,
    });
  }
  return count === 1
    ? t(
        'Also set {{count}} other uncategorized {{payee}} transaction to {{category}}, and save a rule to use {{category}} for {{payee}} from now on?',
        { count, payee, category },
      )
    : t(
        'Also set {{count}} other uncategorized {{payee}} transactions to {{category}}, and save a rule to use {{category}} for {{payee}} from now on?',
        { count, payee, category },
      );
}

export function CategoryOfferStrip({
  state,
  payeeName,
  getCategoryName,
  getAccountName,
  autoFocus,
  onToggleInclude,
  onApply,
  onDecline,
  onUndo,
  onViewRule,
  onDismiss,
  loadReviewRows,
  onHeightChange,
}: CategoryOfferStripProps): ReactElement {
  const { t } = useTranslation();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const rootRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const [reviewRows, setReviewRows] = useState<CategoryOfferReviewRow[] | null>(
    null,
  );
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => onHeightChange(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  useEffect(() => {
    if (autoFocus) {
      applyRef.current?.focus();
    }
  }, [autoFocus, state.key]);

  const { offer } = state;
  const payee = payeeName;
  const sentence = getCategoryOfferAnnouncement(
    state,
    { payee, category: getCategoryName },
    t,
  );
  const reviewCount = offer.uncategorizedIds.length + offer.categorizedCount;

  async function openReview() {
    const rows = await loadReviewRows();
    setTicked(new Set(rows.map(row => row.id)));
    setReviewRows(rows);
  }

  function toggleRow(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setTicked(next);
  }

  function onKeyDown(e: KeyboardEvent) {
    // The table's navigator handles Enter, Tab and the arrows on the
    // container; keys pressed here belong to the strip
    e.stopPropagation();
    if (e.key === 'Escape' && reviewRows === null) {
      if (state.status === 'offer') {
        onDecline();
      } else {
        onDismiss();
      }
    }
  }

  const includeLabel =
    offer.categorizedCategoryId !== null
      ? t('Include {{count}} marked {{category}}', {
          count: offer.categorizedCount,
          category: getCategoryName(offer.categorizedCategoryId),
        })
      : t('Include {{count}} with other categories', {
          count: offer.categorizedCount,
        });

  return (
    <View
      innerRef={rootRef}
      role="region"
      aria-label={t('Category offer')}
      onKeyDown={onKeyDown}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px 16px',
        padding: '10px 12px',
        lineHeight: 1.45,
        backgroundColor: theme.noticeBackgroundLight,
        borderTop: `1px solid ${theme.noticeBorder}`,
        borderBottom: `1px solid ${theme.noticeBorder}`,
        color: theme.noticeText,
      }}
    >
      <View style={{ flex: '1 1 360px' }}>
        <View>{sentence}</View>
        {state.status === 'offer' && offer.replacesRuleCategoryId && (
          <View>
            {t('This replaces the rule that sets {{payee}} to {{category}}.', {
              payee,
              category: getCategoryName(offer.replacesRuleCategoryId),
            })}
          </View>
        )}
        {state.status === 'offer' && offer.hasSpecificRule && (
          <View>
            {t(
              'A more specific rule for {{payee}} can still set a different category.',
              { payee },
            )}
          </View>
        )}
        {state.status === 'offer' && offer.categorizedCount > 0 && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: 6,
              cursor: 'pointer',
            }}
          >
            <Checkbox checked={state.include} onChange={onToggleInclude} />
            {includeLabel}
          </label>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        {state.status === 'offer' ? (
          <>
            {state.include ? (
              <Button
                ref={applyRef}
                variant="primary"
                onPress={() => void openReview()}
              >
                {reviewCount === 1
                  ? t('Review {{count}} change', { count: reviewCount })
                  : t('Review {{count}} changes', { count: reviewCount })}
              </Button>
            ) : (
              <Button
                ref={applyRef}
                variant="primary"
                onPress={() => onApply(undefined)}
              >
                <Trans>Apply</Trans>
              </Button>
            )}
            <Button variant="bare" onPress={onDecline}>
              <Trans>Just this one</Trans>
            </Button>
          </>
        ) : (
          <>
            <Button onPress={onUndo}>
              <Trans>Undo</Trans>
            </Button>
            <Button variant="bare" onPress={onViewRule}>
              <Trans>View rule</Trans>
            </Button>
            <Button variant="bare" onPress={onDismiss}>
              <Trans>Dismiss</Trans>
            </Button>
          </>
        )}
      </View>

      <Popover
        triggerRef={rootRef}
        isOpen={reviewRows !== null}
        onOpenChange={isOpen => {
          if (!isOpen) {
            setReviewRows(null);
          }
        }}
        placement="bottom end"
        style={{ width: 440, padding: 10 }}
      >
        <View style={{ maxHeight: 320, overflow: 'auto', gap: 4 }}>
          {reviewRows?.map(row => (
            <label
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <Checkbox
                checked={ticked.has(row.id)}
                onChange={() => toggleRow(row.id)}
              />
              <span style={{ flex: 1 }}>
                {formatDate(parseISO(row.date), dateFormat)} ·{' '}
                {getAccountName(row.account)} ·{' '}
                {row.category
                  ? getCategoryName(row.category)
                  : t('Uncategorized')}
              </span>
              <FinancialText style={{ marginLeft: 12 }}>
                {format(row.amount, 'financial')}
              </FinancialText>
            </label>
          ))}
        </View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            gap: 6,
            marginTop: 10,
          }}
        >
          <Button variant="bare" onPress={() => setReviewRows(null)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="primary"
            isDisabled={ticked.size === 0}
            onPress={() => {
              const ids = [...ticked];
              setReviewRows(null);
              onApply(ids);
            }}
          >
            {ticked.size === 1
              ? t('Apply {{count}} change and save rule', {
                  count: ticked.size,
                })
              : t('Apply {{count}} changes and save rule', {
                  count: ticked.size,
                })}
          </Button>
        </View>
      </Popover>
    </View>
  );
}
