import { initServer } from '@actual-app/core/platform/client/connection';
import { parseFileContents } from '@actual-app/core/server/transactions/import/parse-file';
import type { ParseFileOptions } from '@actual-app/core/server/transactions/import/parse-file';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { defaultImportSettings } from '#components/modals/ImportTransactionsModal/importSettings';
import {
  configureTestAppStore,
  createTestQueryClient,
  TestProviders,
} from '#mocks';

import { chaseCard } from './csvFixtures';
import { CsvMappingModal } from './CsvMappingModal';
import { csvToSetupRows, initialCsvMapping, toCsvRawRows } from './csvRows';
import type { CsvRawRow } from './csvRows';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);
// The real CSV parser runs in these tests. Its module also imports the
// server file system, which opens IndexedDB on load; parsing bytes never
// touches it, and jsdom has no IndexedDB.
vi.mock('../../../../loot-core/src/platform/server/fs/index.ts', () => ({}));

const FILE = 'Chase1234_Activity20260915.CSV';

function setup(
  initial: ReturnType<typeof initialCsvMapping> | null = null,
  rawRows: CsvRawRow[] = chaseCard,
) {
  const savePref = vi.fn();
  initServer({ 'preferences/save': savePref });
  const store = configureTestAppStore({ queryClient: createTestQueryClient() });
  const prefsBefore = store.getState().prefs.synced;
  const onDone = vi.fn();
  render(
    <TestProviders store={store}>
      <CsvMappingModal
        fileName={FILE}
        fileBytes={new Uint8Array()}
        rawRows={rawRows}
        initial={initial}
        onDone={onDone}
      />
    </TestProviders>,
  );
  return { savePref, store, prefsBefore, onDone };
}

describe('CsvMappingModal', () => {
  it('previews five rows', () => {
    setup();
    expect(screen.getAllByTestId('csv-preview-row')).toHaveLength(5);
  });

  it('returns the edited mapping, closes, and touches no synced prefs', async () => {
    const user = userEvent.setup();
    const { savePref, store, prefsBefore, onDone } = setup();

    // Notes: Memo -> Type, found by the picker's label
    const notes = screen.getByRole('button', { name: 'Notes' });
    expect(notes).toHaveAccessibleDescription('Memo');
    await user.click(notes);
    await user.click(
      within(await screen.findByRole('menu')).getByRole('button', {
        name: 'Type',
      }),
    );
    await user.click(screen.getByLabelText('Flip amount'));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const fieldMappings = {
      date: 'Transaction Date',
      amount: 'Amount',
      payee: 'Description',
      notes: 'Type',
      inOut: null,
      category: null,
      outflow: null,
      inflow: null,
      balance: null,
    };
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      {
        fieldMappings,
        dateFormat: 'mm dd yyyy',
        flipAmount: true,
        multiplier: '',
        inOutMode: false,
        outValue: '',
        settings: {
          ...defaultImportSettings(FILE),
          hasHeaderRow: true,
          fieldMappings,
          parseDateFormat: 'mm dd yyyy',
          flipAmount: true,
          inOutMode: false,
          outValue: '',
        },
      },
      chaseCard,
    );

    expect(savePref).not.toHaveBeenCalled();
    expect(store.getState().prefs.synced).toBe(prefsBefore);
    await waitFor(() =>
      expect(
        screen.queryByTestId('bank-file-setup-csv-mapping-modal'),
      ).not.toBeInTheDocument(),
    );
  });

  it('starts from the mapping it is given', () => {
    const initial = {
      ...initialCsvMapping(FILE, chaseCard),
      flipAmount: true,
    };
    setup(initial);
    expect(screen.getByLabelText('Flip amount')).toBeChecked();
  });

  it('counts one unreadable row in the singular', () => {
    const rawRows = chaseCard.map((r, i) =>
      i === 2 ? { ...r, 'Transaction Date': 'Pending' } : r,
    );
    setup(null, rawRows);
    expect(
      screen.getByText(/^1 row could not be read\. Row 3: Pending/),
    ).toBeInTheDocument();
  });

  it('names a missing column without the unreadable-rows count', () => {
    const mapping = initialCsvMapping(FILE, chaseCard);
    setup({
      ...mapping,
      fieldMappings: { ...mapping.fieldMappings, payee: null },
    });
    expect(screen.getByText('Choose the payee column.')).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('keeps Done disabled when no row can be read', async () => {
    const user = userEvent.setup();
    const rawRows = chaseCard.map(r => ({
      ...r,
      'Transaction Date': 'Pending',
    }));
    const { onDone } = setup(null, rawRows);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    await user.click(done);
    expect(onDone).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('bank-file-setup-csv-mapping-modal'),
    ).toBeInTheDocument();
  });

  describe('header row and skipped lines', () => {
    // Wells Fargo exports have no header row
    const headerless = [
      '"09/15/2026","-120.00","*","","ZELLE TO JANE"',
      '"09/14/2026","2500.00","*","","PAYROLL"',
      '"09/10/2026","-4.50","*","","STARBUCKS"',
    ].join('\n');

    // Bank of America checking puts a summary above the header
    const withPreamble = [
      'Description,,Summary Amt.',
      'Beginning balance as of 09/01/2026,,"1,000.00"',
      '',
      'Date,Description,Amount,Running Bal.',
      '09/10/2026,STARBUCKS,-4.50,995.50',
      '09/14/2026,PAYROLL,2500.00,"3,495.50"',
    ].join('\n');

    async function renderFile(fileName: string, text: string) {
      const bytes = new TextEncoder().encode(text);
      const parse = vi.fn(
        ({ name, options }: { name: string; options?: ParseFileOptions }) =>
          parseFileContents(name, bytes, options),
      );
      initServer({ 'setup-parse-file': parse });
      // What the page does when a CSV is added: parse it with a header row
      const first = await parseFileContents(fileName, bytes, {
        hasHeaderRow: true,
        delimiter: ',',
      });
      const onDone = vi.fn();
      render(
        <TestProviders
          store={configureTestAppStore({
            queryClient: createTestQueryClient(),
          })}
        >
          <CsvMappingModal
            fileName={fileName}
            fileBytes={bytes}
            rawRows={toCsvRawRows(first.transactions ?? [])}
            initial={null}
            onDone={onDone}
          />
        </TestProviders>,
      );
      return { bytes, parse, onDone };
    }

    it('reads every row of a headerless file once the box is unchecked', async () => {
      const user = userEvent.setup();
      const { bytes, parse, onDone } = await renderFile('wf.csv', headerless);
      const box = screen.getByLabelText('File has header row');
      expect(box).toBeChecked();
      // With a header row assumed, the first transaction is lost to it
      expect(screen.getAllByTestId('csv-preview-row')).toHaveLength(2);

      await user.click(box);
      await waitFor(() =>
        expect(screen.getAllByTestId('csv-preview-row')).toHaveLength(3),
      );
      expect(parse).toHaveBeenLastCalledWith({
        name: 'wf.csv',
        bytes,
        options: { hasHeaderRow: false, skipStartLines: 0, delimiter: ',' },
      });

      // Without a header the guess takes the first text column; the payee
      // is the last one
      await user.click(screen.getByRole('button', { name: 'Payee' }));
      await user.click(
        within(await screen.findByRole('menu')).getByRole('button', {
          name: 'Column 5 (ZELLE TO JANE)',
        }),
      );

      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(onDone).toHaveBeenCalledTimes(1);
      const [mapping, rawRows] = onDone.mock.calls[0];
      expect(mapping.settings).toMatchObject({
        hasHeaderRow: false,
        skipStartLines: 0,
      });
      const result = csvToSetupRows('wf', rawRows, mapping);
      expect(result.errors).toEqual([]);
      expect(result.rows.map(r => [r.date, r.amount, r.payeeName])).toEqual([
        ['2026-09-15', -12000, 'ZELLE TO JANE'],
        ['2026-09-14', 250000, 'PAYROLL'],
        ['2026-09-10', -450, 'STARBUCKS'],
      ]);
    });

    it('maps a file with a preamble once its lines are skipped', async () => {
      const user = userEvent.setup();
      const { onDone } = await renderFile('stmt.csv', withPreamble);

      const skip = screen.getByLabelText('Skip start lines:');
      await user.clear(skip);
      await user.type(skip, '3');
      await waitFor(() =>
        expect(screen.getAllByTestId('csv-preview-row')).toHaveLength(2),
      );

      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(onDone).toHaveBeenCalledTimes(1);
      const [mapping, rawRows] = onDone.mock.calls[0];
      expect(mapping.settings).toMatchObject({
        hasHeaderRow: true,
        skipStartLines: 3,
      });
      expect(mapping.fieldMappings).toMatchObject({
        date: 'Date',
        payee: 'Description',
        amount: 'Amount',
      });
      const result = csvToSetupRows('stmt', rawRows, mapping);
      expect(result.errors).toEqual([]);
      expect(result.rows.map(r => [r.date, r.amount])).toEqual([
        ['2026-09-10', -450],
        ['2026-09-14', 250000],
      ]);
    });
  });
});
