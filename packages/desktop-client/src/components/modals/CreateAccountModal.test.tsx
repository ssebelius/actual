import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';
import { pushModal } from '#modals/modalsSlice';

import { CreateAccountModal } from './CreateAccountModal';

vi.mock('#components/banksync/useBuiltInBankSyncProviders', () => ({
  useBuiltInBankSyncProviders: () => ({
    providers: [],
    syncServerStatus: 'online',
    permissionWarning: null,
  }),
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

describe('CreateAccountModal', () => {
  const originalWidth = window.innerWidth;
  let store: ReturnType<typeof createTestAppStore>;

  beforeEach(() => {
    resetTestProviders();
    store = createTestAppStore();
    store.dispatch(pushModal({ modal: { name: 'add-account', options: {} } }));
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  function renderModal() {
    render(
      <TestProviders store={store}>
        <MemoryRouter initialEntries={['/budget']}>
          <Routes>
            <Route path="/budget" element={<CreateAccountModal />} />
            <Route path="/setup" element={<SetupStub />} />
          </Routes>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  it('closes and opens setup from "Set up from bank files"', async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'Set up from bank files' }),
    );

    expect(screen.getByText('Setup page')).toBeVisible();
    expect(screen.getByText('skipChoice: true')).toBeVisible();
    expect(store.getState().modals.modalStack).toEqual([]);
  });

  it('hides the option on narrow screens', async () => {
    window.innerWidth = 400;
    renderModal();

    // The modal fades in after mount, so wait for that before asserting
    // visibility rather than catching it mid-animation.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create a local account' }),
      ).toBeVisible(),
    );
    expect(
      screen.queryByRole('button', { name: 'Set up from bank files' }),
    ).not.toBeInTheDocument();
  });
});
