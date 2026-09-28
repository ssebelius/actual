import { MemoryRouter, Route, Routes } from 'react-router';

import type * as ConnectionModule from '@actual-app/core/platform/client/connection';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';
import { initServer, send } from '#mocks/connection';

import { chaseCard } from './csvFixtures';
import { buildCsvMapping, initialCsvMapping } from './csvRows';
import { SetupPage } from './SetupPage';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

// prefsSlice (like every other Redux slice) is imported, as a side effect of
// `combineReducers`, by setupTests.ts before this file's own `vi.mock` above
// can apply: that binds its `send` import to the real, unmocked
// implementation ahead of time. Spying on the real module's already-bound
// `send` export (rather than only the swapped module) reaches that binding,
// the way budgetfilesSlice.test.ts does.
const realConnection = await vi.importActual<typeof ConnectionModule>(
  '@actual-app/core/platform/client/connection',
);
const sendSpy = vi.spyOn(realConnection, 'send').mockImplementation(send);

// A card statement with no ledger balance, so the card asks what was owed on
// its last transaction, Sep 10. Rows: +523.10 on Aug 4, -40.00 on Sep 10.
const cardStatement = {
  kind: 'credit',
  org: 'Chase',
  fid: '10898',
  bankId: null,
  accountId: '4400110937',
  accountType: null,
  start: '2026-08-01',
  end: '2026-09-10',
  ledgerBalance: null,
  ledgerDate: null,
  transactions: [
    {
      amount: 523.1,
      date: '2026-08-04',
      payee_name: 'Payment Thank You',
      imported_payee: 'Payment Thank You',
      notes: null,
      imported_id: 'c1',
    },
    {
      amount: -40,
      date: '2026-09-10',
      payee_name: 'Coffee',
      imported_payee: 'Coffee',
      notes: null,
      imported_id: 'c2',
    },
  ],
  errors: [],
};

// The same card with one row whose amount the parser could not read. The
// file-level errors repeat it, as they do for OFX (they come from the merged
// list), and must not make the whole file unreadable.
const unreadable = {
  message: 'Invalid amount format: N/A',
  internal: 'Failed to parse amount: N/A',
};
const badCardStatement = {
  ...cardStatement,
  accountId: '4400119999',
  errors: [unreadable],
};

// A checking statement whose ledger balance is dated on its end, so no
// question. Rows: -523.10 on Aug 3 (the card payment), +1,000.00 on Sep 1.
const checkingStatement = {
  kind: 'bank',
  org: 'Chase',
  fid: '10898',
  bankId: '322271627',
  accountId: '000123454821',
  accountType: 'CHECKING',
  start: '2026-08-01',
  end: '2026-09-26',
  ledgerBalance: 2410.55,
  ledgerDate: '2026-09-26',
  transactions: [
    {
      amount: -523.1,
      date: '2026-08-03',
      payee_name: 'Payment to Chase card',
      imported_payee: 'Payment to Chase card',
      notes: null,
      imported_id: 'k1',
    },
    {
      amount: 1000,
      date: '2026-09-01',
      payee_name: 'Payroll',
      imported_payee: 'Payroll',
      notes: null,
      imported_id: 'k2',
    },
  ],
  errors: [],
};

// Aug 14 reads only as month first, so the guessed date format is certain
const csvRows = [
  {
    'Transaction Date': '08/14/2026',
    Description: 'Payment Thank You',
    Amount: '523.10',
  },
];

// The same rows plus one whose date no format reads
const badDateCsvRows = [
  ...csvRows,
  { 'Transaction Date': 'Pending', Description: 'Coffee', Amount: '-40.00' },
];

function parseFile(args: unknown) {
  const name =
    typeof args === 'object' && args !== null && 'name' in args
      ? args.name
      : null;
  switch (name) {
    case 'card.qfx':
      return { errors: [], transactions: [], statements: [cardStatement] };
    case 'checking.qfx':
      return { errors: [], transactions: [], statements: [checkingStatement] };
    case 'bad-card.qfx':
      return {
        errors: [unreadable],
        transactions: [],
        statements: [badCardStatement],
      };
    case 'activity.csv':
      return { errors: [], transactions: csvRows };
    case 'bad-date.csv':
      return { errors: [], transactions: badDateCsvRows };
    default:
      return { errors: [{ message: 'Unknown fixture', internal: '' }] };
  }
}

function serve(
  create: (input: unknown) => unknown = () => ({
    ok: true,
    accountIds: [],
    transactionCount: 0,
  }),
) {
  const parse = vi.fn(parseFile);
  initServer({ 'setup-parse-file': parse, 'setup-create': create });
  return parse;
}

function renderPage({ state }: { state?: unknown } = {}) {
  const queryClient = createTestQueryClient();
  const store = configureTestAppStore({ queryClient });
  render(
    <TestProviders store={store} queryClient={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/setup', state }]}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route
            path="/categories/uncategorized"
            element={<p>Uncategorized list</p>}
          />
          <Route path="/budget" element={<p>Budget page</p>} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
  return store;
}

async function chooseSetup() {
  await userEvent.click(
    screen.getByRole('button', { name: /^Set up from bank files/ }),
  );
  expect(
    screen.getByRole('heading', { name: 'Your accounts' }),
  ).toBeInTheDocument();
}

function cards() {
  return screen.getAllByTestId('setup-account-card');
}

function reason() {
  const element = document.getElementById('setup-footer-reason');
  if (!element) {
    throw new Error('No footer reason');
  }
  return element;
}

async function upload(card: HTMLElement, name: string, content: string) {
  const input = card.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('No file input in the card');
  }
  await userEvent.upload(input, new File([content], name));
}

async function fillAccount(card: HTMLElement, name: string, balance: string) {
  await userEvent.type(
    within(card).getByRole('textbox', { name: 'Account name' }),
    name,
  );
  await userEvent.type(
    within(card).getByRole('textbox', { name: 'What is the balance today?' }),
    `${balance}{Enter}`,
  );
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

// Adds a mapped card CSV to the first account and enters its balance, so a
// Create can be triggered from the state Task 14's tests need. Returns the
// `send` spy so a test can see whether `preferences/save` fired.
async function renderWithMappedCardCsv({
  createResult,
}: {
  createResult: unknown;
}) {
  initServer({
    'setup-parse-file': () => ({ errors: [], transactions: chaseCard }),
    'setup-create': () => createResult,
    'preferences/save': () => null,
  });

  const store = renderPage();
  await chooseSetup();
  const card = cards()[0];
  await userEvent.type(
    within(card).getByRole('textbox', { name: 'Account name' }),
    'Card',
  );

  const fileName = 'Chase0937_Activity.CSV';
  await upload(card, fileName, 'Transaction Date,Post Date,Description');
  await within(card).findByText('Needs columns');
  await userEvent.click(
    within(card).getByRole('button', { name: /^Map columns/ }),
  );
  const modal = store.getState().modals.modalStack.at(-1);
  if (modal?.name !== 'bank-file-setup-csv-mapping') {
    throw new Error('The column mapping did not open');
  }
  const initial = modal.options.initial;
  if (initial === null) {
    throw new Error('No initial mapping');
  }
  await act(async () => modal.options.onDone(initial, modal.options.rawRows));

  const owed = within(card).getByRole('textbox', { name: /balance|owe/i });
  await userEvent.type(owed, '412.60{Enter}');

  sendSpy.mockClear();
  return { sendMock: sendSpy };
}

test('starts with the choice, and starting empty goes to the budget', async () => {
  serve();
  renderPage();
  expect(
    screen.getByRole('heading', { name: 'How do you want to start?' }),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: /^Start with an empty budget/ }),
  );
  expect(screen.getByText('Budget page')).toBeInTheDocument();
});

test('skips the choice when opened with skipChoice', async () => {
  serve();
  renderPage({ state: { skipChoice: true } });
  expect(
    screen.queryByRole('heading', { name: 'How do you want to start?' }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { name: 'Your accounts' }),
  ).toBeInTheDocument();
});

test('setting up opens one empty account card and the review', async () => {
  serve();
  renderPage();
  await chooseSetup();
  expect(cards()).toHaveLength(1);
  expect(
    within(cards()[0]).getByRole('heading', { name: 'Account 1' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'What will be created' }),
  ).toBeInTheDocument();
});

test('a blocked Create stays focusable and moves focus to the first blocker', async () => {
  const create = vi.fn();
  serve(create);
  renderPage();
  await chooseSetup();

  const button = screen.getByRole('button', { name: 'Create' });
  expect(button).toBeEnabled();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAttribute('aria-describedby', 'setup-footer-reason');
  expect(reason()).toHaveTextContent(
    'Before you can create: Account 1 needs a name.',
  );

  await userEvent.click(button);
  const name = screen.getByRole('textbox', { name: 'Account name' });
  expect(name).toHaveFocus();

  await userEvent.type(name, 'Cash');
  expect(reason()).toHaveTextContent(
    'Before you can create: Cash needs a balance.',
  );
  await userEvent.click(button);
  const balance = screen.getByRole('textbox', {
    name: 'What is the balance today?',
  });
  expect(balance).toHaveFocus();

  // The account named in the reason is a link to the same control
  await userEvent.click(within(reason()).getByRole('button', { name: 'Cash' }));
  expect(balance).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
});

test('entering an amount owed keeps focus and announces the starting balance', async () => {
  serve();
  renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'card.qfx', 'card statement');
  const owed = await within(card).findByRole('textbox', {
    name: 'How much did you owe on September 10?',
  });
  expect(
    within(card).getByRole('textbox', { name: 'Account name' }),
  ).toHaveValue('Chase Card ••0937');
  expect(within(card).getByRole('textbox', { name: 'Bank' })).toHaveValue(
    'Chase',
  );
  expect(within(card).getByText('Needs a balance')).toBeInTheDocument();

  await userEvent.type(owed, '1126.48{Enter}');

  expect(owed).toHaveFocus();
  // Known -1,126.48 on Sep 10, less the net of +523.10 and -40.00 (483.10)
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Chase Card ••0937: starting balance 1,609.58 owed on Aug 4.',
    ),
  );
  const table = screen.getByRole('table', { name: 'What will be created' });
  expect(within(table).getByText('1,609.58 owed')).toBeInTheDocument();
  // Ending: -1,609.58 + 483.10
  expect(within(table).getByText('1,126.48 owed')).toBeInTheDocument();
  expect(within(card).queryByText('Needs a balance')).toBeNull();
});

test('a CSV needs its columns mapped, and the mapping fills the card', async () => {
  const parse = serve();
  const store = renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'activity.csv', 'Transaction Date,Description,Amount');
  expect(await within(card).findByText('Needs columns')).toBeInTheDocument();
  // Without a header row the parser returns bare string arrays
  expect(parse).toHaveBeenCalledWith({
    name: 'activity.csv',
    bytes: expect.any(Uint8Array),
    options: { hasHeaderRow: true, delimiter: ',' },
  });
  expect(
    within(card).getByText(
      'Tell Actual which columns in activity.csv hold the date, description and amount.',
    ),
  ).toBeInTheDocument();
  expect(
    within(card).getByText('1 row found · columns not mapped yet'),
  ).toBeInTheDocument();

  await userEvent.click(
    within(card).getByRole('button', { name: /^Map columns/ }),
  );
  const modal = store.getState().modals.modalStack.at(-1);
  if (modal?.name !== 'bank-file-setup-csv-mapping') {
    throw new Error('The column mapping did not open');
  }
  expect(modal.options.fileName).toBe('activity.csv');
  expect(modal.options.rawRows).toEqual(csvRows);
  const initial = modal.options.initial;
  expect(initial).toEqual(initialCsvMapping('activity.csv', csvRows));
  if (initial === null) {
    throw new Error('No initial mapping');
  }

  // What the modal's Done does: hand back a mapping
  await act(async () => modal.options.onDone(initial, modal.options.rawRows));

  expect(within(card).queryByText('Needs columns')).toBeNull();
  expect(within(card).getByText('1 transaction, Aug 14')).toBeInTheDocument();
  expect(
    within(card).getByRole('textbox', {
      name: 'What was the balance on August 14?',
    }),
  ).toHaveFocus();
});

test('a CSV row the mapping cannot read blocks Create until the file is fixed or removed', async () => {
  const create = vi.fn();
  serve(create);
  const store = renderPage();
  await chooseSetup();
  const card = cards()[0];
  await userEvent.type(
    within(card).getByRole('textbox', { name: 'Account name' }),
    'Card',
  );

  await upload(card, 'bad-date.csv', 'Transaction Date,Description,Amount');
  await within(card).findByText('Needs columns');
  await userEvent.click(
    within(card).getByRole('button', { name: /^Map columns/ }),
  );
  const modal = store.getState().modals.modalStack.at(-1);
  if (modal?.name !== 'bank-file-setup-csv-mapping') {
    throw new Error('The column mapping did not open');
  }
  const initial = modal.options.initial;
  if (initial === null) {
    throw new Error('No initial mapping');
  }
  await act(async () => modal.options.onDone(initial, modal.options.rawRows));

  // The row that parsed is kept and shown; the other is reported
  expect(within(card).getByText('1 transaction, Aug 14')).toBeInTheDocument();
  expect(within(card).getByText('Fix or remove this file')).toBeInTheDocument();
  expect(
    within(card).getByText(
      '1 row could not be read: Row 2: Pending is not a date in the chosen format.',
    ),
  ).toBeInTheDocument();
  expect(reason()).toHaveTextContent(
    'Before you can create: Card has a file to fix or remove.',
  );

  const button = screen.getByRole('button', { name: 'Create' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(button);
  expect(
    within(card).getByRole('button', { name: 'Remove bad-date.csv' }),
  ).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
});

test('the same file added twice is refused with a message', async () => {
  serve();
  renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'card.qfx', 'card statement');
  await within(card).findByRole('textbox', {
    name: 'How much did you owe on September 10?',
  });
  await upload(card, 'card.qfx', 'card statement');

  expect(
    await within(card).findByText(
      'card.qfx was already added to Chase Card ••0937.',
    ),
  ).toBeInTheDocument();
  expect(within(card).getAllByText('card.qfx')).toHaveLength(1);
});

test('a statement with unreadable rows blocks Create until its file is removed', async () => {
  const create = vi.fn();
  serve(create);
  renderPage();
  await chooseSetup();
  const card = cards()[0];

  await upload(card, 'bad-card.qfx', 'bad card statement');

  expect(
    await within(card).findByText('Fix or remove this file'),
  ).toBeInTheDocument();
  expect(
    within(card).getByText(
      '1 row could not be read: Invalid amount format: N/A',
    ),
  ).toBeInTheDocument();
  expect(reason()).toHaveTextContent(
    'Before you can create: Chase Card ••9999 has a file to fix or remove.',
  );

  const button = screen.getByRole('button', { name: 'Create' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(button);
  const remove = within(card).getByRole('button', {
    name: 'Remove bad-card.qfx',
  });
  expect(remove).toHaveFocus();
  expect(create).not.toHaveBeenCalled();

  await userEvent.click(remove);
  expect(within(card).queryByText('Fix or remove this file')).toBeNull();
  expect(reason()).toHaveTextContent(
    'Before you can create: Chase Card ••9999 needs a balance.',
  );
});

test('a confirmed transfer is sent with Create', async () => {
  const create = vi.fn(() => ({
    ok: true,
    accountIds: ['card', 'checking'],
    transactionCount: 4,
  }));
  serve(create);
  renderPage();
  await chooseSetup();

  await upload(cards()[0], 'card.qfx', 'card statement');
  const owed = await within(cards()[0]).findByRole('textbox', {
    name: 'How much did you owe on September 10?',
  });
  await userEvent.type(owed, '1126.48{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
  await upload(cards()[1], 'checking.qfx', 'checking statement');

  const confirm = await screen.findByRole('button', {
    name: 'Confirm transfer of 523.10 from Chase Checking ••4821 to Chase Card ••0937, Aug 3',
  });
  // Ledger 2,410.55 on Sep 26, less the net of -523.10 and +1,000.00 (476.90)
  expect(
    within(
      screen.getByRole('table', { name: 'What will be created' }),
    ).getByText('1,933.65'),
  ).toBeInTheDocument();
  expect(reason()).toHaveTextContent(
    '2 accounts and 4 transactions will be created. 1 likely transfer not answered: it will be imported as two transactions.',
  );

  await userEvent.click(confirm);
  expect(screen.getByRole('button', { name: /^Change/ })).toHaveFocus();
  expect(reason()).toHaveTextContent(
    /^2 accounts and 4 transactions will be created\.$/,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    accounts: [
      expect.objectContaining({
        name: 'Chase Card ••0937',
        type: 'credit',
        entered: 112648,
      }),
      expect.objectContaining({
        name: 'Chase Checking ••4821',
        type: 'checking',
        entered: null,
      }),
    ],
    confirmedPairs: [
      {
        outRowId: `${await sha256('checking statement')}:0`,
        inRowId: `${await sha256('card statement')}:0`,
      },
    ],
    today: '2017-01-01',
  });
});

test('pressing Create twice sends one request (Review Focus 4)', async () => {
  let finish: (result: unknown) => void = () => undefined;
  const create = vi.fn(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  serve(create);
  renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');

  const button = screen.getByRole('button', { name: 'Create' });
  expect(button).toHaveAttribute('aria-disabled', 'false');

  await userEvent.dblClick(button);
  expect(button).toHaveTextContent('Creating…');
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('textbox', { name: 'Account name' })).toBeDisabled();
  await userEvent.click(button);

  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    accounts: [
      {
        id: expect.any(String),
        name: 'Cash',
        bank: '',
        type: 'checking',
        offbudget: false,
        files: [],
        entered: 5000,
      },
    ],
    confirmedPairs: [],
    today: '2017-01-01',
  });

  await act(async () =>
    finish({ ok: true, accountIds: ['cash'], transactionCount: 0 }),
  );
  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
});

test('Create posts the summary and opens the uncategorized list', async () => {
  // The summary counts what the server reports it created
  serve(() => ({
    ok: true,
    accountIds: ['cash', 'savings'],
    transactionCount: 486,
  }));
  const store = renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');
  await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
  await fillAccount(cards()[1], 'Savings', '1000');
  expect(reason()).toHaveTextContent(
    '2 accounts and 0 transactions will be created.',
  );

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
  expect(
    store.getState().notifications.notifications.map(n => n.message),
  ).toEqual([
    'Created 2 accounts and 486 transactions. They are uncategorized; start with the ones below. Past months will look overspent because nothing was budgeted in them.',
  ]);
});

test('Create with a warning still opens the list and adds a second notice', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  serve(() => ({
    ok: true,
    accountIds: ['cash'],
    transactionCount: 0,
    warning: 'Failed to save import settings',
  }));
  const store = renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByText('Uncategorized list')).toBeInTheDocument();
  expect(
    store
      .getState()
      .notifications.notifications.map(({ type, message, sticky }) => ({
        type,
        message,
        sticky,
      })),
  ).toEqual([
    {
      type: 'message',
      message:
        'Created 1 account and 0 transactions. They are uncategorized; start with the ones below. Past months will look overspent because nothing was budgeted in them.',
      sticky: undefined,
    },
    {
      type: 'warning',
      message:
        'Everything was created, but a step after saving did not finish. Your accounts and transactions are safe.',
      sticky: undefined,
    },
  ]);
  expect(log).toHaveBeenCalledWith(
    'Bank file setup warning:',
    'Failed to save import settings',
  );
  log.mockRestore();
});

test('a failed Create shows the error and keeps the draft', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  serve(() => ({ ok: false, error: 'Disk full' }));
  renderPage();
  await chooseSetup();
  await fillAccount(cards()[0], 'Cash', '50');

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  // The server's message is English and technical; the page shows its own
  await waitFor(() =>
    expect(document.getElementById('setup-create-error')).toHaveTextContent(
      'Nothing was created. Check the accounts and try again.',
    ),
  );
  expect(log).toHaveBeenCalledWith('Bank file setup failed:', 'Disk full');
  log.mockRestore();
  const name = screen.getByRole('textbox', { name: 'Account name' });
  expect(name).toHaveValue('Cash');
  expect(name).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
});

test('Close setup asks before leaving once an account exists', async () => {
  serve();
  renderPage();
  await chooseSetup();

  await userEvent.click(screen.getByRole('button', { name: 'Close setup' }));
  expect(
    screen.getByText(
      'Leave setup? The accounts you added have not been created.',
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Leave setup' }));
  expect(screen.getByText('Budget page')).toBeInTheDocument();
});

test('saves the mapped CSV settings under the new account id', async () => {
  const { sendMock } = await renderWithMappedCardCsv({
    createResult: { ok: true, accountIds: ['card'], transactionCount: 2 },
  });

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() => {
    const saved = sendMock.mock.calls
      .filter(([name]) => name === 'preferences/save')
      .map(([, args]) => (args as { id: string }).id);
    expect(saved).toContain('csv-mappings-card');
    expect(saved).toContain('parse-date-card-csv');
  });
});

test('maps with the header and skip options chosen and saves them', async () => {
  initServer({
    'setup-parse-file': () => ({ errors: [], transactions: chaseCard }),
    'setup-create': () => ({
      ok: true,
      accountIds: ['card'],
      transactionCount: 3,
    }),
    'preferences/save': () => null,
  });
  const store = renderPage();
  await chooseSetup();
  const card = cards()[0];
  await userEvent.type(
    within(card).getByRole('textbox', { name: 'Account name' }),
    'Checking',
  );
  const content = 'Transaction Date,Post Date,Description';
  await upload(card, 'export.csv', content);
  await within(card).findByText('Needs columns');
  await userEvent.click(
    within(card).getByRole('button', { name: /^Map columns/ }),
  );
  const modal = store.getState().modals.modalStack.at(-1);
  if (modal?.name !== 'bank-file-setup-csv-mapping') {
    throw new Error('The column mapping did not open');
  }
  const initial = modal.options.initial;
  if (initial === null) {
    throw new Error('No initial mapping');
  }
  // The modal gets the file's bytes so it can parse them again
  expect(Array.from(modal.options.fileBytes)).toEqual(
    Array.from(new TextEncoder().encode(content)),
  );

  // What the modal's Done hands back after the file was parsed again with
  // no header row and three skipped lines
  const reparsed = [
    ['09/15/2026', 'Zelle to Jane', '-120.00'],
    ['09/14/2026', 'Payroll', '2500.00'],
    ['09/10/2026', 'Starbucks', '-4.50'],
  ];
  const mapping = buildCsvMapping(
    { ...initial.settings, hasHeaderRow: false, skipStartLines: 3 },
    {
      fieldMappings: {
        date: '0',
        payee: '1',
        amount: '2',
        notes: null,
        inOut: null,
        category: null,
        outflow: null,
        inflow: null,
        balance: null,
      },
      dateFormat: 'mm dd yyyy',
      flipAmount: false,
      multiplier: '',
      inOutMode: false,
      outValue: '',
    },
  );
  await act(async () => modal.options.onDone(mapping, reparsed));
  expect(within(card).getByText(/^3 transactions/)).toBeInTheDocument();

  await userEvent.type(
    within(card).getByRole('textbox', { name: /balance|owe/i }),
    '100{Enter}',
  );
  sendSpy.mockClear();
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() => {
    const saved = sendSpy.mock.calls
      .filter(([name]) => name === 'preferences/save')
      .map(([, args]) => args);
    expect(saved).toEqual(
      expect.arrayContaining([
        { id: 'csv-has-header-card', value: 'false' },
        { id: 'csv-skip-start-lines-card', value: '3' },
      ]),
    );
  });
});

test('does not save settings when Create fails', async () => {
  const { sendMock } = await renderWithMappedCardCsv({
    createResult: { ok: false, error: 'boom' },
  });

  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await screen.findByText(
    'Nothing was created. Check the accounts and try again.',
  );
  expect(
    sendMock.mock.calls.some(([name]) => name === 'preferences/save'),
  ).toBe(false);
});
