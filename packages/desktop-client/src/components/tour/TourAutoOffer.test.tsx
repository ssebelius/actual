import { MemoryRouter } from 'react-router';

import type * as PlatformModule from '@actual-app/core/shared/platform';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNavigate } from '#hooks/useNavigate';
import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';

import { TourAutoOffer } from './TourAutoOffer';
import { TOUR_OFFER_NOTIFICATION_ID, TourProvider } from './TourProvider';

vi.mock('@actual-app/core/shared/platform', async () => {
  const actual = await vi.importActual<typeof PlatformModule>(
    '@actual-app/core/shared/platform',
  );
  return { ...actual, isPlaywright: false };
});

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(to)}>Go to {to}</button>;
}

describe('TourAutoOffer', () => {
  let store: ReturnType<typeof createTestAppStore>;

  beforeEach(() => {
    resetTestProviders();
    store = createTestAppStore();
    window.localStorage.clear();
  });

  function renderAt(path: string) {
    render(
      <TestProviders store={store}>
        <MemoryRouter initialEntries={[path]}>
          <TourProvider>
            <TourAutoOffer />
            <GoTo to="/categories/uncategorized" />
          </TourProvider>
        </MemoryRouter>
      </TestProviders>,
    );
  }

  function tourOffers() {
    return store
      .getState()
      .notifications.notifications.filter(
        notification => notification.id === TOUR_OFFER_NOTIFICATION_ID,
      );
  }

  it('offers the tour on the budget page', () => {
    renderAt('/budget');

    expect(tourOffers()).toHaveLength(1);
  });

  it('waits while setup is open and offers the tour after leaving it', async () => {
    renderAt('/setup');

    expect(tourOffers()).toHaveLength(0);

    await userEvent.click(
      screen.getByRole('button', { name: 'Go to /categories/uncategorized' }),
    );

    expect(tourOffers()).toHaveLength(1);
  });
});
