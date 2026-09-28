import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LiveRegion, useAnnounce } from './LiveRegion';

function Announcer({ messages }: { messages: string[] }) {
  const announce = useAnnounce();
  return (
    <button
      type="button"
      onClick={() => messages.forEach(message => announce(message))}
    >
      Announce
    </button>
  );
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

describe('LiveRegion', () => {
  it('renders one polite, atomic status region that starts empty', () => {
    render(<LiveRegion />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toBeEmptyDOMElement();
  });

  it('announces from a component rendered before the region', async () => {
    render(
      <>
        <Announcer messages={['Parsed Chase checking.qfx: 212 transactions']} />
        <LiveRegion />
      </>,
    );
    const region = screen.getByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Announce' }));
    // Cleared synchronously, set on the next frame
    expect(region).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(region).toHaveTextContent(
        'Parsed Chase checking.qfx: 212 transactions',
      ),
    );
  });

  it('re-announces an identical message by clearing it first', async () => {
    render(
      <>
        <LiveRegion />
        <Announcer messages={['Starting balance updated']} />
      </>,
    );
    const region = screen.getByRole('status');
    const button = screen.getByRole('button', { name: 'Announce' });

    fireEvent.click(button);
    await waitFor(() =>
      expect(region).toHaveTextContent('Starting balance updated'),
    );

    fireEvent.click(button);
    expect(region).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(region).toHaveTextContent('Starting balance updated'),
    );
  });

  it('drops a message replaced before its frame', async () => {
    render(
      <>
        <LiveRegion />
        <Announcer messages={['Parsing statement.csv', 'Needs columns']} />
      </>,
    );
    const region = screen.getByRole('status');
    const seen: string[] = [];
    const observer = new MutationObserver(() =>
      seen.push(region.textContent ?? ''),
    );
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Announce' }));
    await waitFor(() => expect(region).toHaveTextContent('Needs columns'));
    await nextFrame();
    observer.disconnect();

    expect(seen).not.toContain('Parsing statement.csv');
    expect(region).toHaveTextContent('Needs columns');
  });

  it("does not carry a message to the next page's region", async () => {
    const first = render(
      <>
        <LiveRegion />
        <Announcer messages={['Created 3 accounts']} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Announce' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Created 3 accounts',
      ),
    );
    first.unmount();

    render(<LiveRegion />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
