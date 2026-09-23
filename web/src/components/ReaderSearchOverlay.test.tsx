import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
// A loaded text search that never answers, so no hits land after a test ends.
vi.mock('../lib/search/textClient', () => ({
  beginTextSearchLoad: vi.fn(),
  subscribeTextSearch: () => () => {},
  textSearchStatus: () => 'ready',
  searchText: () => new Promise(() => {}),
}));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
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

// openOverlay opens the overlay as it was left with `query` in the box.
function openOverlay(query: string) {
  const saved: { current: ReaderSearchView | null } = {
    current: { query, shown: 1, scrollTop: 0, activeIndex: 0 },
  };
  render(
    <ReaderSearchOverlay theme={READER_THEMES.light} currentId="dn1" saved={saved} onOpenSutta={vi.fn()} onClose={vi.fn()} />
  );
  return screen.getByPlaceholderText(READER_SEARCH_PLACEHOLDER);
}

describe('ReaderSearchOverlay focus on opening', () => {
  beforeEach(() => {
    vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue({
      lists: [],
      notes: {},
      membership: {},
      highlights: {},
    } as unknown as ReturnType<typeof useUserData>);
    vi.mocked(useLayout).mockReturnValue({ mobile: true } as ReturnType<typeof useLayout>);
  });
  afterEach(() => vi.unstubAllGlobals());

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
