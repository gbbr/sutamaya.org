import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../lib/search/textClient', () => ({
  beginTextSearchLoad: vi.fn(),
  subscribeTextSearch: () => () => {},
  textSearchStatus: () => 'ready',
  searchText: vi.fn(),
}));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { searchText } from '../lib/search/textClient';
import { ReaderSearchOverlay, type ReaderSearchView } from './ReaderSearchOverlay';
import { READER_SEARCH_PLACEHOLDER } from '../lib/search/metadata';
import { READER_THEMES } from '../lib/theme';
import type { Corpus } from '../lib/types';

const corpus: Corpus = {
  nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
  suttas: { dn1: { ref: 'DN 1', node: 'dn', en: 'The Divine Net', pali: 'Brahmajāla', blurb: '', min: 5 } },
  sujatoCommit: 'abc1234',
  dataVersion: 'data-v1',
  searchVersion: 'search-v1',
  dictionaryVersion: 'dict-v1',
};

// stubPointer reports the page as driven by touch or by a mouse.
function stubPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse'), media: query }));
}

// leftAt returns the overlay as it was left with `query` in the box and `shown` passages showing.
function leftAt(query: string, shown = 1): { current: ReaderSearchView | null } {
  return { current: { query, shown, scrollTop: 0, activeIndex: 0 } };
}

// openOverlay opens the overlay as it was left with `query` in the box.
function openOverlay(query: string) {
  render(
    <ReaderSearchOverlay
      theme={READER_THEMES.light}
      currentId="dn1"
      saved={leftAt(query)}
      onOpenSutta={vi.fn()}
      onClose={vi.fn()}
    />
  );
  return screen.getByPlaceholderText(READER_SEARCH_PLACEHOLDER);
}

// Harness mounts the overlay over dn1 as ReaderPage does: opening a row closes it, and the Search
// button opens it again.
function Harness({
  saved,
  onOpenSutta,
}: {
  saved: { current: ReaderSearchView | null };
  onOpenSutta: (id: string, passage?: { segments: [number, number] }) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return <button onClick={() => setOpen(true)}>Search</button>;
  return (
    <ReaderSearchOverlay
      theme={READER_THEMES.light}
      currentId="dn1"
      saved={saved}
      onOpenSutta={(id, passage) => {
        setOpen(false);
        onOpenSutta(id, passage);
      }}
      onClose={() => setOpen(false)}
    />
  );
}

// passage returns a passage of dn1 holding "divine", at segment `n`.
function passage(n: number) {
  const marks: Array<[number, number]> = [[4, 10]];
  return {
    text: `the divine net, passage ${n}`,
    marks,
    segments: [n, n] as [number, number],
    markedBy: { queries: ['divine'], anywhere: true },
  };
}

beforeEach(() => {
  vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
  vi.mocked(useUserData).mockReturnValue({
    lists: [],
    notes: {},
    membership: {},
    highlights: {},
  } as unknown as ReturnType<typeof useUserData>);
  vi.mocked(useLayout).mockReturnValue({ mobile: true } as ReturnType<typeof useLayout>);
  // A text search that never answers, so no hits land after a test ends.
  vi.mocked(searchText).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => vi.unstubAllGlobals());

describe('ReaderSearchOverlay focus on opening', () => {
  it('leaves a touch screen keyboard down when it reopens on a query', () => {
    stubPointer(true);
    expect(openOverlay('divine')).not.toHaveFocus();
  });

  it('focuses the field on a touch screen when there is no query', () => {
    stubPointer(true);
    expect(openOverlay('')).toHaveFocus();
  });

  it('focuses the field with the query selected when driven by a mouse', () => {
    stubPointer(false);
    const input = openOverlay('divine') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'divine'.length]);
  });
});

describe('ReaderSearchOverlay reopening after a row is opened', () => {
  // A click with no pointer movement before it, as a tap on a touch screen arrives.
  it('reopens on the passage that was opened, rather than the first', async () => {
    vi.mocked(searchText).mockResolvedValue([
      { id: 'dn1', rank: 0, saved: false, passages: [passage(1), passage(2), passage(3)] },
    ]);
    const onOpenSutta = vi.fn();
    const { container } = render(<Harness saved={leftAt('divine', 3)} onOpenSutta={onOpenSutta} />);
    const rows = () => container.querySelectorAll<HTMLButtonElement>('button.row');

    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(rows()[1]);
    expect(onOpenSutta).toHaveBeenLastCalledWith('dn1', expect.objectContaining({ segments: [2, 2] }));

    // Enter opens the row the cursor is on.
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.keyDown(screen.getByPlaceholderText(READER_SEARCH_PLACEHOLDER), { key: 'Enter' });
    expect(onOpenSutta).toHaveBeenLastCalledWith('dn1', expect.objectContaining({ segments: [2, 2] }));
  });
});
