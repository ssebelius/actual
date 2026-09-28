import { createRef } from 'react';

import { render, screen } from '@testing-library/react';

import { FixedSizeList } from './FixedSizeList';
import { Table } from './table';

type Gap = { afterIndex: number; size: number };

function renderList(gap?: Gap) {
  const ref = createRef<FixedSizeList>();
  const tops: Record<number, number> = {};
  const list = (g?: Gap) => (
    <FixedSizeList
      ref={ref}
      width={500}
      height={300}
      itemCount={50}
      itemSize={31}
      renderRow={({ index, style, key }) => {
        tops[index] = Number(style.top);
        return <div key={key} data-index={index} />;
      }}
      gap={g && { ...g, content: <div data-testid="gap" /> }}
    />
  );
  const { rerender } = render(list(gap));
  return {
    list: ref.current!,
    tops,
    setGap: (g?: Gap) => rerender(list(g)),
  };
}

describe('FixedSizeList gap', () => {
  test('rows after the gap move down by its size', () => {
    const { tops } = renderList({ afterIndex: 2, size: 64 });
    expect(tops[2]).toBe(62);
    expect(tops[3]).toBe(3 * 31 + 64);
    expect(screen.getByTestId('gap')).toBeInTheDocument();
  });

  test('total size, start index and scroll offsets account for the gap', () => {
    const { list } = renderList({ afterIndex: 2, size: 64 });
    expect(list.getEstimatedTotalSize()).toBe(50 * 31 + 64);
    // An offset inside the gap maps to the row after it
    expect(list.getStartIndexForOffset(3 * 31 + 10)).toBe(3);
    expect(list.getStartIndexForOffset(3 * 31 + 64 + 31)).toBe(4);
    expect(list.getOffsetForIndexAndAlignment(10, 'start', 0)).toBe(
      10 * 31 + 64,
    );
  });

  test('rows already rendered move when the gap opens, resizes and closes', () => {
    // The list caches each row's style; the gap must be part of its key
    const { tops, setGap } = renderList();
    expect(tops[3]).toBe(93);
    setGap({ afterIndex: 2, size: 64 });
    expect(tops[3]).toBe(3 * 31 + 64);
    setGap({ afterIndex: 2, size: 80 });
    expect(tops[3]).toBe(3 * 31 + 80);
    setGap(undefined);
    expect(tops[3]).toBe(93);
  });

  test('without a gap nothing changes', () => {
    const { list, tops } = renderList();
    expect(tops[3]).toBe(93);
    expect(list.getEstimatedTotalSize()).toBe(50 * 31);
  });
});

describe('Table gap', () => {
  test('stays at its last index when its row leaves the list', () => {
    const table = (items: Array<{ id: string }>) => (
      <Table
        items={items}
        renderItem={({ item }) => <div>{item.id}</div>}
        gap={{
          afterId: 'b',
          size: 40,
          content: <div data-testid="gap" />,
        }}
      />
    );
    const { rerender } = render(table([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    expect(screen.getByTestId('gap')).toBeInTheDocument();
    rerender(table([{ id: 'a' }, { id: 'c' }]));
    expect(screen.getByTestId('gap')).toBeInTheDocument();
  });

  test('still shows its content when the list empties', () => {
    // An Apply in the uncategorized view can remove every row
    const table = (items: Array<{ id: string }>) => (
      <Table
        items={items}
        renderItem={({ item }) => <div>{item.id}</div>}
        renderEmpty="Nothing here"
        gap={{
          afterId: 'b',
          size: 40,
          content: <div data-testid="gap" />,
        }}
      />
    );
    const { rerender } = render(table([{ id: 'b' }]));
    rerender(table([]));
    expect(screen.getByTestId('gap')).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
