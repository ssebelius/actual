import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountQueries } from '#accounts';
import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { pushModal } from '#modals/modalsSlice';

import { CreateLocalAccountModal } from './CreateLocalAccountModal';

let mockServerStatus: 'no-server' | 'online' = 'no-server';

vi.mock('#hooks/useSyncServerStatus', () => ({
  useSyncServerStatus: () => mockServerStatus,
}));

// Reports whether the navigation that reached it carried skipChoice, so a
// test can prove the entry point's click sent it.
function SetupStub() {
  const location = useLocation();
  const skipChoice =
    (location.state as { skipChoice?: unknown } | null)?.skipChoice === true;
  return (
    <div>
      <div>Setup page</div>
      <div>skipChoice: {String(skipChoice)}</div>
    </div>
  );
}

describe('CreateLocalAccountModal', () => {
  const originalWidth = window.innerWidth;
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let store: ReturnType<typeof configureTestAppStore>;

  beforeEach(() => {
    mockServerStatus = 'no-server';
    queryClient = createTestQueryClient();
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    store = configureTestAppStore({ queryClient });
    store.dispatch(pushModal({ modal: { name: 'add-local-account' } }));
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  function renderModal() {
    render(
      <TestProviders store={store} queryClient={queryClient}>
        <MemoryRouter initialEntries={['/budget']}>
          <Routes>
            <Route path="/budget" element={<CreateLocalAccountModal />} />
            <Route path="/setup" element={<SetupStub />} />
          </Routes>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  it('offers setup above the form when there is no sync server', async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'Set up from bank files' }),
    );

    expect(screen.getByText('Setup page')).toBeVisible();
    expect(screen.getByText('skipChoice: true')).toBeVisible();
    expect(store.getState().modals.modalStack).toEqual([]);
  });

  it('leaves the offer to the previous screen when a sync server is in use', () => {
    mockServerStatus = 'online';
    renderModal();

    // InlineField renders the label as "Name:", so match loosely.
    expect(screen.getByLabelText('Name', { exact: false })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Set up from bank files' }),
    ).not.toBeInTheDocument();
  });

  it('hides the offer on narrow screens', () => {
    window.innerWidth = 400;
    renderModal();

    expect(
      screen.queryByRole('button', { name: 'Set up from bank files' }),
    ).not.toBeInTheDocument();
  });
});
