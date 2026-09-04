import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Router, navigate } from '@reach/router';

// The scroll position of a search's results across a reader round trip: scrolled, a hit opened,
// the reader closed. The sutta text's hits arrive after the metadata ones, so the pane's restore
// is held until they land — this file mounts a text search that is loaded and answers, which is
// the state the app is in for every search after the first.

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../context/ReaderPrefsContext', () => ({ useReaderPrefs: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));
// A loaded text search that answers every query with the metadata hits it was given, in order:
// enough to put the hook through its "the text hits have landed" transition.
vi.mock('../lib/search/textClient', () => ({
  beginTextSearchLoad: vi.fn(),
  subscribeTextSearch: () => () => {},
  textSearchStatus: () => 'ready',
  searchText: (_query: string, meta: Array<{ id: string; rank: number; saved: boolean }>) =>
    Promise.resolve(meta.map(({ id, rank }) => ({ id, rank }))),
}));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { LibraryPage } from './LibraryPage';
import { ReaderPage } from './ReaderPage';
import { SEARCH_PLACEHOLDER } from '../lib/search/metadata';
import type { Corpus } from '../lib/types';

function buildCorpus(): Corpus {
  const suttas: Corpus['suttas'] = {};
  for (let i = 1; i <= 40; i++) {
    suttas[`dn${i}`] = {
      ref: `DN ${i}`,
      node: 'dn',
      en: `Discourse ${i}`,
      pali: `Sutta ${i}`,
      blurb: `The ${i}th long discourse`,
      min: 5,
    };
  }
  return {
    nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 40 }],
    suttas,
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
    searchVersion: 'search-v1',
    dictionaryVersion: 'dict-v1',
  };
}

const userDataDefaults: ReturnType<typeof useUserData> = {
  ready: true,
  lists: [],
  membership: {},
  notes: {},
  highlights: {},
  visited: {},
  syncStatus: 'synced',
  pendingCount: 0,
  lastSyncedAt: null,
  needsReauth: false,
  listMembers: () => [],
  createList: async () => {
    throw new Error('unused');
  },
  renameList: async () => {},
  removeList: async () => {},
  reorderLists: async () => {},
  reorderListItems: async () => {},
  toggleMembership: async () => {},
  addToList: async () => {},
  submitNote: async () => {},
  setHighlightSpan: async () => {},
  markVisited: () => {},
};

describe('a search result opened and closed', () => {
  // Every element `scrollIntoView` was called on, in order. jsdom's own is a no-op, so this is the
  // only way to see the reveal that would otherwise scroll the restored position away.
  let revealed: Element[] = [];

  beforeEach(() => {
    revealed = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      revealed.push(this);
    };
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(userDataDefaults);
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isSignedIn: false,
      dataUserId: 'local-test',
      localUserId: 'local-test',
      loading: false,
      authError: null,
      requestEmailCode: vi.fn(async () => {}),
      signInWithEmailCode: vi.fn(async () => {}),
      promptGoogleSignIn: vi.fn(),
      logout: vi.fn(async () => {}),
    });
    vi.mocked(useLayout).mockReturnValue({
      mobile: false,
      w: 1200,
      treeW: 264,
      paneW: { tree: 264, treeMax: 400 },
      resetTree: vi.fn(),
      dragTree: vi.fn(),
    });
    vi.mocked(useReaderPrefs).mockReturnValue({
      theme: 'light',
      resolvedTheme: 'light',
      fs: 18,
      lh: 165,
      face: 'serif',
      allPali: false,
      paliAbove: false,
      showNotes: true,
      showHighlights: true,
      setTheme: vi.fn(),
      setFs: vi.fn(),
      setLh: vi.fn(),
      setFace: vi.fn(),
      toggleAllPali: vi.fn(),
      togglePaliAbove: vi.fn(),
      toggleShowNotes: vi.fn(),
      toggleShowHighlights: vi.fn(),
      revealHighlights: vi.fn(),
      cycleTheme: vi.fn(),
    });
  });

  it('reopens the results at the offset they were left at', async () => {
    navigate('/browse/dn');
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);
    const list = () => within(container.querySelector('[data-component="ListPane"]')!);
    const listScroller = () => container.querySelector('[data-component="ListPane"] .sc') as HTMLElement;
    await screen.findByText('sutamaya');

    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    // Matched in the blurb, so the titles the rows are found by here render unmarked.
    fireEvent.change(tree().getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'long' } });
    await list().findByText('Discourse 30');

    // Scrolled well down the results, the way a reader reaches a hit that isn't near the top.
    const scroller = listScroller();
    scroller.scrollTop = 900;
    scroller.dispatchEvent(new Event('scroll'));

    fireEvent.click(list().getByText('Discourse 30'));
    await waitFor(() => expect(container.querySelector('[data-component="ReaderPage"]')).toBeTruthy(), {
      timeout: 5000,
    });

    fireEvent.click(screen.getByTitle('Close'));
    await screen.findByText('sutamaya');
    revealed = [];
    await waitFor(() => expect(listScroller().scrollTop).toBe(900));

    // The cursor lands on the hit that was opened, but nothing scrolls to it — the row would be
    // dragged to the edge of the pane, which is not where it was left.
    expect(list().getByText('Discourse 30').closest('button')!.className).toContain('bg-ink/[.05]');
    expect(revealed.some((el) => el.textContent?.includes('Discourse 30'))).toBe(false);
    expect(listScroller().scrollTop).toBe(900);
  });

  it('opens a new query at the top, and leaves it there once the text hits land', async () => {
    navigate('/browse/dn');
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);
    const list = () => within(container.querySelector('[data-component="ListPane"]')!);
    const listScroller = () => container.querySelector('[data-component="ListPane"] .sc') as HTMLElement;
    await screen.findByText('sutamaya');

    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    const input = tree().getByPlaceholderText(SEARCH_PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'long' } });
    await list().findByText('Discourse 30');
    listScroller().scrollTop = 900;
    listScroller().dispatchEvent(new Event('scroll'));

    fireEvent.change(input, { target: { value: 'discourses' } });
    await waitFor(() => expect(listScroller().scrollTop).toBe(0));
    // The held restore lands a moment after the rows do, and must not put the offset the query
    // before this one was left at back.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listScroller().scrollTop).toBe(0);
  });

  it('follows the arrow-key cursor once the reader moves it', async () => {
    navigate('/browse/dn');
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);
    const list = () => within(container.querySelector('[data-component="ListPane"]')!);
    await screen.findByText('sutamaya');

    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    fireEvent.change(tree().getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'long' } });
    await list().findByText('Discourse 2');

    revealed = [];
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(revealed.some((el) => el.textContent?.includes('Discourse 2'))).toBe(true));
  });

  it('on mobile, restores the results in the tree column and hands the tree back its own place', async () => {
    vi.mocked(useLayout).mockReturnValue({
      mobile: true,
      w: 400,
      treeW: 264,
      paneW: { tree: 264, treeMax: 400 },
      resetTree: vi.fn(),
      dragTree: vi.fn(),
    });
    navigate('/browse/dn');
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);
    const treeScroller = () => container.querySelector('[data-component="TreePane"] .sc') as HTMLElement;
    await screen.findByText('sutamaya');

    // Where the tree itself was left, which the results must not take over.
    treeScroller().scrollTop = 300;
    treeScroller().dispatchEvent(new Event('scroll'));

    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    fireEvent.change(tree().getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'long' } });
    await tree().findByText('Discourse 30');
    treeScroller().scrollTop = 900;
    treeScroller().dispatchEvent(new Event('scroll'));

    fireEvent.click(tree().getByText('Discourse 30'));
    await waitFor(() => expect(container.querySelector('[data-component="ReaderPage"]')).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.click(screen.getByTitle('Close'));
    await screen.findByText('sutamaya');
    await waitFor(() => expect(treeScroller().scrollTop).toBe(900));

    // The tree's own place, which the search never took over. In a real browser TreePane's node
    // reveal can move it on from here — this is where the column opens, not where it settles.
    fireEvent.click(tree().getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(treeScroller().scrollTop).toBe(300));
  });
});
