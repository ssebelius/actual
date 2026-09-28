import {
  initServer,
  serverPush,
} from '@actual-app/core/platform/client/connection';
import { act, renderHook } from '@testing-library/react';

import { useCategoryOffer } from './useCategoryOffer';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

const offer = {
  transactionId: 'edited',
  payeeId: 'cfa',
  categoryId: 'fast',
  uncategorizedIds: ['uncat'],
  categorizedCount: 0,
  categorizedCategoryId: null,
  replacesRuleCategoryId: null,
  hasSpecificRule: false,
};
const result = {
  changedCount: 1,
  ruleId: 'r1',
  restore: { transactions: [], createdRuleId: 'r1', updatedRules: [] },
};

let calls: Array<[string, unknown]>;
beforeEach(() => {
  calls = [];
  const record =
    <R>(name: string, value?: R) =>
    async (args: unknown): Promise<R> => {
      calls.push([name, args]);
      return value as R;
    };
  initServer({
    'category-offer-apply': record('apply', result),
    'category-offer-undo': record('undo'),
    'category-offer-learn': record('learn'),
    'category-offer-review-rows': record('rows', []),
  });
});
afterEach(() => global.__resetWorld());

// Lets queued mock-server calls settle
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

function setup() {
  const onRefetch = vi.fn();
  const hook = renderHook(() => useCategoryOffer({ onRefetch }));
  // A save whose response carries an offer, with nothing saved since
  const open = (o = offer, previous: string | null = null) =>
    act(() => {
      const seq = hook.result.current.beginSave();
      hook.result.current.show(o, previous, seq);
    });
  return { hook, onRefetch, open };
}

test('an unanswered offer runs the learner once when the next save closes it', async () => {
  const { hook, open } = setup();
  open();
  act(() => {
    hook.result.current.beginSave();
  });
  act(() => {
    hook.result.current.beginSave();
  });
  await flush();
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
  expect(hook.result.current.state).toBeNull();
});

test('a response from an older save learns instead of showing', async () => {
  // Row A is saved, then row B is saved before A's response arrives
  const { hook } = setup();
  let seqA = 0;
  let seqB = 0;
  act(() => {
    seqA = hook.result.current.beginSave();
    seqB = hook.result.current.beginSave();
  });
  act(() => {
    hook.result.current.show(offer, null, seqA);
  });
  await flush();
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
  expect(hook.result.current.state).toBeNull();
  act(() => {
    hook.result.current.show({ ...offer, transactionId: 'b' }, null, seqB);
  });
  expect(hook.result.current.state?.offer.transactionId).toBe('b');
});

test('an offer that replaces an open one learns for the old edit', async () => {
  const { hook } = setup();
  let seq = 0;
  act(() => {
    seq = hook.result.current.beginSave();
  });
  act(() => {
    hook.result.current.show(offer, null, seq);
  });
  act(() => {
    hook.result.current.show({ ...offer, transactionId: 'other' }, null, seq);
  });
  await flush();
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
  expect(hook.result.current.state?.offer.transactionId).toBe('other');
});

test('declining learns nothing', async () => {
  const { hook, open } = setup();
  open();
  act(() => {
    hook.result.current.decline();
  });
  act(() => {
    hook.result.current.beginSave();
  });
  await flush();
  expect(calls).toEqual([]);
});

test('apply sends the edit context, highlights and refetches; undo restores', async () => {
  const { hook, onRefetch, open } = setup();
  open(offer, 'dining');
  await act(async () => {
    await hook.result.current.apply();
  });
  expect(calls[0]).toEqual([
    'apply',
    {
      transactionId: 'edited',
      categoryId: 'fast',
      previousCategoryId: 'dining',
      onlyIds: undefined,
    },
  ]);
  expect(hook.result.current.state?.status).toBe('applied');
  expect([...hook.result.current.highlightedIds]).toEqual(['uncat']);
  expect(onRefetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    await hook.result.current.undo();
  });
  expect(calls[1]).toEqual(['undo', { restore: result.restore }]);
  expect(hook.result.current.state).toBeNull();
  expect(onRefetch).toHaveBeenCalledTimes(2);
});

test('a second Apply while the first is in flight is ignored', async () => {
  const { hook, open } = setup();
  open();
  await act(async () => {
    await Promise.all([
      hook.result.current.apply(),
      hook.result.current.apply(),
    ]);
  });
  expect(calls.filter(([name]) => name === 'apply')).toHaveLength(1);
});

test('a save during Apply neither learns nor brings the confirmation back', async () => {
  const { hook, onRefetch, open } = setup();
  open();
  await act(async () => {
    const applying = hook.result.current.apply();
    hook.result.current.beginSave();
    await applying;
  });
  await flush();
  expect(calls.map(([name]) => name)).toEqual(['apply']);
  expect(hook.result.current.state).toBeNull();
  expect(onRefetch).toHaveBeenCalled();
});

test('a global undo closes an open offer as unanswered', async () => {
  const { hook, open } = setup();
  open();
  await act(async () => {
    serverPush('undo-event', {});
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
  expect(hook.result.current.state).toBeNull();
});

test('a global undo removes the confirmation and its Undo', async () => {
  const { hook, open } = setup();
  open();
  await act(async () => {
    await hook.result.current.apply();
  });
  await act(async () => {
    serverPush('undo-event', {});
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(hook.result.current.state).toBeNull();
  expect(calls.map(([name]) => name)).toEqual(['apply']);
});

test('any later change to transactions or rules removes the confirmation', async () => {
  // Bulk edits, deletes and other devices change data without a table
  // save; Undo must not restore over them
  const { hook, open } = setup();
  open();
  await act(async () => {
    await hook.result.current.apply();
  });
  await act(async () => {
    serverPush('sync-event', { type: 'applied', tables: ['payees'] });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(hook.result.current.state?.status).toBe('applied');
  await act(async () => {
    serverPush('sync-event', { type: 'applied', tables: ['transactions'] });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(hook.result.current.state).toBeNull();
});

test('unmounting with an open offer runs the learner', async () => {
  const { hook, open } = setup();
  open();
  hook.unmount();
  await flush();
  expect(calls).toEqual([['learn', { transactionId: 'edited' }]]);
});
