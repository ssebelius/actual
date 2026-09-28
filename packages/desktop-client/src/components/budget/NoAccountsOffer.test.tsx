import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import { generateAccount } from '@actual-app/core/mocks';
import { initServer } from '@actual-app/core/platform/client/connection';
import type { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountQueries } from '#accounts';
import { createTestQueryClient, TestProviders } from '#mocks';

import { NoAccountsOffer } from './NoAccountsOffer';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

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

describe('NoAccountsOffer', () => {
  const originalWidth = window.innerWidth;
  let queryClient: QueryClient;

  beforeEach(() => {
    // accounts-get never answers, so an unseeded query stays on its placeholder
    initServer({ 'accounts-get': () => new Promise(() => undefined) });
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  function renderOffer() {
    render(
      <TestProviders queryClient={queryClient}>
        <MemoryRouter initialEntries={['/budget']}>
          <Routes>
            <Route path="/budget" element={<NoAccountsOffer />} />
            <Route path="/setup" element={<SetupStub />} />
          </Routes>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  it('offers setup when the budget has no accounts', () => {
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    renderOffer();

    expect(screen.getByText('No accounts yet')).toBeVisible();
    expect(
      screen.getByText(
        'Set up this budget from the files you downloaded from your banks.',
      ),
    ).toBeVisible();
  });

  it('opens setup from its button', async () => {
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    renderOffer();

    await userEvent.click(
      screen.getByRole('button', { name: 'Set up from bank files' }),
    );

    expect(screen.getByText('Setup page')).toBeVisible();
    expect(screen.getByText('skipChoice: true')).toBeVisible();
  });

  it('is hidden once the budget has an account', () => {
    queryClient.setQueryData(accountQueries.list().queryKey, [
      generateAccount('Checking'),
    ]);
    renderOffer();

    expect(screen.queryByText('No accounts yet')).not.toBeInTheDocument();
  });

  it('is hidden while accounts are still loading', () => {
    renderOffer();

    expect(screen.queryByText('No accounts yet')).not.toBeInTheDocument();
  });

  it('is hidden on narrow screens', () => {
    window.innerWidth = 400;
    queryClient.setQueryData(accountQueries.list().queryKey, []);
    renderOffer();

    expect(screen.queryByText('No accounts yet')).not.toBeInTheDocument();
  });
});
