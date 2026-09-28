import { useEffect, useRef, useState } from 'react';

import { listen, send } from '@actual-app/core/platform/client/connection';
import type {
  CategoryOffer,
  CategoryOfferReviewRow,
} from '@actual-app/core/types/models';

import type { CategoryOfferState } from './CategoryOfferStrip';

const HIGHLIGHT_MS = 1500;

export type CategoryOfferController = {
  state: CategoryOfferState | null;
  highlightedIds: ReadonlySet<string>;
  /** Call at the start of every save. Closes an open offer as unanswered
   * (running the learner for it) and returns this save's sequence number. */
  beginSave: () => number;
  /** Shows the offer if `saveSeq` is still the latest save; otherwise runs
   * the learner for it. Also learns for any open offer it replaces. */
  show: (
    offer: CategoryOffer,
    previousCategoryId: string | null,
    saveSeq: number,
  ) => void;
  toggleInclude: () => void;
  apply: (onlyIds?: string[]) => Promise<void>;
  decline: () => void;
  undo: () => Promise<void>;
  dismiss: () => void;
  loadReviewRows: () => Promise<CategoryOfferReviewRow[]>;
};

export function useCategoryOffer({
  onRefetch,
}: {
  onRefetch: () => void;
}): CategoryOfferController {
  const [state, setState] = useState<CategoryOfferState | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Read by beginSave, show and the unmount cleanup, which can run before
  // a re-render has delivered the latest state
  const stateRef = useRef<CategoryOfferState | null>(null);
  const nextKey = useRef(0);
  // Saves do not wait for the server, so a response can arrive after a
  // later save has started; only the latest save may show an offer
  const latestSave = useRef(0);
  // Set while Apply waits on the server: the person has answered, so
  // nothing may learn for the offer or apply it a second time
  const applying = useRef(false);

  function update(next: CategoryOfferState | null) {
    stateRef.current = next;
    setState(next);
  }

  function learn(offer: CategoryOffer) {
    void send('category-offer-learn', { transactionId: offer.transactionId });
  }

  function learnIfOpen() {
    const current = stateRef.current;
    if (current?.status === 'offer' && !applying.current) {
      learn(current.offer);
    }
  }

  useEffect(
    () =>
      // A global undo means Apply is no longer the latest change. An open
      // offer goes unanswered; the learner reads current data, so running
      // it after the edit itself was undone is harmless.
      listen('undo-event', () => {
        learnIfOpen();
        update(null);
      }),
    // Mount-only: the listener reads current state through stateRef
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(
    () =>
      // Undo is offered only while Apply is the latest change. Bulk edits,
      // deletes, rule edits and other devices change data without a table
      // save, so any later change to transactions or rules removes it.
      listen('sync-event', event => {
        if (
          event.type === 'applied' &&
          stateRef.current?.status === 'applied' &&
          event.tables.some(
            table => table === 'transactions' || table === 'rules',
          )
        ) {
          update(null);
        }
      }),
    // Mount-only: the listener reads current state through stateRef
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (highlightedIds.size === 0) {
      return;
    }
    const id = setTimeout(() => setHighlightedIds(new Set()), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [highlightedIds]);

  // Leaving the view counts as no answer
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => learnIfOpen(), []);

  return {
    state,
    highlightedIds,
    beginSave() {
      learnIfOpen();
      update(null);
      return ++latestSave.current;
    },
    show(offer, previousCategoryId, saveSeq) {
      if (saveSeq !== latestSave.current) {
        learn(offer);
        return;
      }
      learnIfOpen();
      update({
        status: 'offer',
        key: ++nextKey.current,
        offer,
        previousCategoryId,
        include: false,
      });
    },
    toggleInclude() {
      const current = stateRef.current;
      if (current?.status === 'offer') {
        update({ ...current, include: !current.include });
      }
    },
    async apply(onlyIds) {
      const current = stateRef.current;
      if (current?.status !== 'offer' || applying.current) {
        return;
      }
      applying.current = true;
      let result;
      try {
        result = await send('category-offer-apply', {
          transactionId: current.offer.transactionId,
          categoryId: current.offer.categoryId,
          previousCategoryId: current.previousCategoryId,
          onlyIds,
        });
      } finally {
        applying.current = false;
      }
      // A save while Apply was in flight closed the strip: Apply is no
      // longer the latest change, so its Undo is not offered
      if (stateRef.current?.key === current.key) {
        update({
          status: 'applied',
          key: current.key,
          offer: current.offer,
          result,
        });
      }
      setHighlightedIds(new Set(onlyIds ?? current.offer.uncategorizedIds));
      onRefetch();
    },
    decline() {
      update(null);
    },
    async undo() {
      const current = stateRef.current;
      if (current?.status !== 'applied') {
        return;
      }
      update(null);
      await send('category-offer-undo', { restore: current.result.restore });
      onRefetch();
    },
    dismiss() {
      update(null);
    },
    loadReviewRows() {
      const current = stateRef.current;
      if (!current) {
        return Promise.resolve([]);
      }
      return send('category-offer-review-rows', {
        transactionId: current.offer.transactionId,
        categoryId: current.offer.categoryId,
      });
    },
  };
}
