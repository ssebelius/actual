import type { NavigateFunction } from 'react-router';

import * as connection from '@actual-app/core/platform/client/connection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore } from '#mocks';
import { initServer, send } from '#mocks/connection';

import { createBudget } from './budgetfilesSlice';

// `budgetfilesSlice` (like every other Redux slice) is imported, as a side
// effect of `combineReducers`, before this file's own `vi.mock` calls can
// apply: `setupTests.ts` builds the app's real store for every test file,
// which binds every slice's own `send` import to the real, unmocked
// implementation ahead of time. Spying on the already-bound module's `send`
// export (rather than swapping the whole module) reaches that binding.
vi.spyOn(connection, 'send').mockImplementation(send);

describe('createBudget', () => {
  let navigate: ReturnType<typeof vi.fn<NavigateFunction>>;

  beforeEach(() => {
    initServer({
      'create-budget': () => ({}),
      'get-budgets': () => [],
      'get-remote-files': () => [],
      'load-prefs': () => ({ id: 'new-budget', budgetName: 'My Finances' }),
      'load-global-prefs': () => ({}),
      'preferences/get': () => ({}),
    });
    navigate = vi.fn<NavigateFunction>();
    window.__navigate = navigate as unknown as NavigateFunction;
  });

  afterEach(() => {
    delete window.__navigate;
  });

  it('opens setup once the new budget has loaded', async () => {
    const store = createTestAppStore();
    let budgetIdWhenNavigating: string | undefined;
    navigate.mockImplementation(() => {
      budgetIdWhenNavigating = store.getState().prefs.local?.id;
    });

    await store.dispatch(createBudget({ openSetup: true }));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/setup');
    expect(budgetIdWhenNavigating).toBe('new-budget');
    expect(store.getState().app.loadingText).toBeNull();
  });

  it('does not navigate without the option', async () => {
    const store = createTestAppStore();

    await store.dispatch(createBudget({}));

    expect(navigate).not.toHaveBeenCalled();
  });
});
