import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestProviders } from '#mocks';

import { CategoryOfferStrip } from './CategoryOfferStrip';
import type {
  CategoryOfferState,
  CategoryOfferStripProps,
} from './CategoryOfferStrip';

const offer = {
  transactionId: 'edited',
  payeeId: 'cfa',
  categoryId: 'fast',
  uncategorizedIds: ['uncat'],
  categorizedCount: 10,
  categorizedCategoryId: 'dining',
  replacesRuleCategoryId: null,
  hasSpecificRule: false,
};
const names: Record<string, string> = {
  fast: 'Fast food',
  dining: 'Dining Out',
};

function renderStrip(
  state: CategoryOfferState,
  overrides: Partial<CategoryOfferStripProps> = {},
) {
  const props = {
    state,
    payeeName: 'Chick-fil-A',
    getCategoryName: (id: string) => names[id],
    getAccountName: () => 'Checking',
    autoFocus: false,
    onToggleInclude: vi.fn(),
    onApply: vi.fn(),
    onDecline: vi.fn(),
    onUndo: vi.fn(),
    onViewRule: vi.fn(),
    onDismiss: vi.fn(),
    loadReviewRows: vi.fn(async () => [
      {
        id: 'uncat',
        date: '2026-04-04',
        amount: -1200,
        account: 'checking',
        category: null,
      },
      {
        id: 'dine1',
        date: '2026-06-01',
        amount: -1200,
        account: 'checking',
        category: 'dining',
      },
    ]),
    onHeightChange: vi.fn(),
    ...overrides,
  };
  // Stands in for the table's navigator, which must not see strip keys
  const outerKeyDown = vi.fn();
  render(
    <TestProviders>
      <div role="group" onKeyDown={outerKeyDown}>
        <CategoryOfferStrip {...props} />
      </div>
    </TestProviders>,
  );
  return { ...props, outerKeyDown };
}

const offerState: CategoryOfferState = {
  status: 'offer',
  key: 1,
  offer,
  previousCategoryId: null,
  include: false,
};

test('states the offer and the rule', () => {
  renderStrip(offerState);
  expect(
    screen.getByText(
      'Also set 1 other uncategorized Chick-fil-A transaction to Fast food, and save a rule to use Fast food for Chick-fil-A from now on?',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: 'Include 10 marked Dining Out' }),
  ).not.toBeChecked();
});

test('plural copy for several uncategorized rows', () => {
  renderStrip({
    ...offerState,
    offer: { ...offer, uncategorizedIds: ['a', 'b'] },
  });
  expect(
    screen.getByText(
      'Also set 2 other uncategorized Chick-fil-A transactions to Fast food, and save a rule to use Fast food for Chick-fil-A from now on?',
    ),
  ).toBeInTheDocument();
});

test('rule-only copy when nothing is uncategorized', () => {
  renderStrip({
    ...offerState,
    offer: {
      ...offer,
      uncategorizedIds: [],
      categorizedCount: 0,
      categorizedCategoryId: null,
    },
  });
  expect(
    screen.getByText(
      'Save a rule to use Fast food for Chick-fil-A from now on?',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('mixed categories are included by count', () => {
  renderStrip({
    ...offerState,
    offer: { ...offer, categorizedCount: 14, categorizedCategoryId: null },
  });
  expect(
    screen.getByRole('checkbox', {
      name: 'Include 14 with other categories',
    }),
  ).toBeInTheDocument();
});

test('names the rule it replaces and a more specific rule', () => {
  renderStrip({
    ...offerState,
    offer: {
      ...offer,
      replacesRuleCategoryId: 'dining',
      hasSpecificRule: true,
    },
  });
  expect(
    screen.getByText(
      'This replaces the rule that sets Chick-fil-A to Dining Out.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'A more specific rule for Chick-fil-A can still set a different category.',
    ),
  ).toBeInTheDocument();
});

test('toggling Include is reported', async () => {
  const props = renderStrip(offerState);
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Include 10 marked Dining Out' }),
  );
  expect(props.onToggleInclude).toHaveBeenCalled();
});

test('Apply, Just this one and Escape', async () => {
  const props = renderStrip(offerState, { autoFocus: true });
  expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(props.onApply).toHaveBeenCalledWith(undefined);
  await userEvent.click(screen.getByRole('button', { name: 'Just this one' }));
  expect(props.onDecline).toHaveBeenCalledTimes(1);
  screen.getByRole('button', { name: 'Apply' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(props.onDecline).toHaveBeenCalledTimes(2);
});

test('with include on, Apply becomes a review of every row, all ticked', async () => {
  const props = renderStrip({ ...offerState, include: true });
  await userEvent.click(
    screen.getByRole('button', { name: 'Review 11 changes' }),
  );
  const boxes = await screen.findAllByRole('checkbox', { name: /Checking/ });
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeChecked();
  expect(boxes[1]).toBeChecked();
  await userEvent.click(boxes[1]);
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply 1 change and save rule' }),
  );
  expect(props.onApply).toHaveBeenCalledWith(['uncat']);
  // The review closes, so it cannot be applied twice or cover the table
  await waitFor(() =>
    expect(
      screen.queryAllByRole('checkbox', { name: /Checking/ }),
    ).toHaveLength(0),
  );
});

test('a single change reads in the singular', () => {
  renderStrip({
    ...offerState,
    include: true,
    offer: { ...offer, uncategorizedIds: [], categorizedCount: 1 },
  });
  expect(
    screen.getByRole('button', { name: 'Review 1 change' }),
  ).toBeInTheDocument();
});

test('confirmation offers Undo, View rule and Dismiss', async () => {
  const props = renderStrip({
    status: 'applied',
    key: 1,
    offer,
    result: {
      changedCount: 1,
      ruleId: 'r1',
      restore: { transactions: [], createdRuleId: 'r1', updatedRules: [] },
    },
  });
  expect(
    screen.getByText(
      'Updated 1 transaction and saved a rule: Chick-fil-A → Fast food.',
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await userEvent.click(screen.getByRole('button', { name: 'View rule' }));
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(props.onUndo).toHaveBeenCalled();
  expect(props.onViewRule).toHaveBeenCalled();
  expect(props.onDismiss).toHaveBeenCalled();
});

test('rule-only confirmation', () => {
  renderStrip({
    status: 'applied',
    key: 1,
    offer,
    result: {
      changedCount: 0,
      ruleId: 'r1',
      restore: { transactions: [], createdRuleId: 'r1', updatedRules: [] },
    },
  });
  expect(
    screen.getByText('Saved a rule: Chick-fil-A → Fast food.'),
  ).toBeInTheDocument();
});

test('keys pressed in the strip do not reach the table', async () => {
  const props = renderStrip(offerState, { autoFocus: true });
  await userEvent.keyboard('{Tab}');
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard('{ArrowDown}');
  expect(props.outerKeyDown).not.toHaveBeenCalled();
});
