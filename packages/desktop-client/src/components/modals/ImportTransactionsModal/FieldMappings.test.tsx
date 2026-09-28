import { render, screen } from '@testing-library/react';

import { FieldMappings } from './FieldMappings';
import type { FieldMapping } from './utils';

const row = {
  'Transaction Date': '09/14/2026',
  Description: 'STARBUCKS STORE 03512',
  Memo: 'coffee',
  Type: 'Sale',
  'Debit/Credit': '-4.50',
  Direction: 'out',
  'Running Bal': '2380.55',
};

const mappings: FieldMapping = {
  date: 'Transaction Date',
  payee: 'Description',
  notes: 'Memo',
  category: 'Type',
  amount: 'Debit/Credit',
  inOut: 'Direction',
  outflow: null,
  inflow: null,
  balance: 'Running Bal',
};

function renderMappings(
  props: Partial<Parameters<typeof FieldMappings>[0]> = {},
) {
  return render(
    <FieldMappings
      transactions={[row]}
      mappings={mappings}
      onChange={vi.fn()}
      splitMode={false}
      inOutMode={false}
      hasHeaderRow
      {...props}
    />,
  );
}

describe('FieldMappings', () => {
  it('names each column picker by its label and describes it by the chosen column', () => {
    renderMappings({ showBalance: true });
    const expected: Array<[string, string]> = [
      ['Date', 'Transaction Date'],
      ['Payee', 'Description'],
      ['Notes', 'Memo'],
      ['Category', 'Type'],
      ['Amount', 'Debit/Credit'],
      ['Balance', 'Running Bal'],
    ];
    for (const [label, column] of expected) {
      expect(
        screen.getByRole('button', { name: label }),
      ).toHaveAccessibleDescription(column);
    }
  });

  it('names the outflow, inflow and in/out pickers', () => {
    const { unmount } = renderMappings({
      splitMode: true,
      mappings: { ...mappings, amount: null, outflow: 'Debit/Credit' },
    });
    expect(
      screen.getByRole('button', { name: 'Outflow' }),
    ).toHaveAccessibleDescription('Debit/Credit');
    expect(screen.getByRole('button', { name: 'Inflow' })).toBeInTheDocument();
    unmount();

    renderMappings({ inOutMode: true });
    expect(
      screen.getByRole('button', { name: 'In/Out' }),
    ).toHaveAccessibleDescription('Direction');
  });

  it("keeps the import dialog's layout: category shown, no balance", () => {
    renderMappings();
    expect(
      screen.getByRole('button', { name: 'Category' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Balance' }),
    ).not.toBeInTheDocument();
  });

  it('hides category when asked', () => {
    renderMappings({ showCategory: false });
    expect(
      screen.queryByRole('button', { name: 'Category' }),
    ).not.toBeInTheDocument();
  });
});
