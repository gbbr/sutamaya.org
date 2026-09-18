import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { renderRoutes } from '../testRouter';

// A collection found by the Library's search: its row among the results, and where opening it
// lands — a group of suttas on its list, a group that only expands open in the tree.
//
// Rendered through the real Router with the contexts mocked, as unresolvedNodes.test.tsx does.

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../context/ReaderPrefsContext', () => ({ useReaderPrefs: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));
// A loaded text search that answers with the metadata hits it was given, as searchScrollReturn.test.tsx's.
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
import { SEARCH_PLACEHOLDER } from '../lib/search/metadata';
import type { Corpus, ListDef } from '../lib/types';

// SN47 only expands, into its vagga; AN's vagga holds its suttas and shares SN47's English name.
// DN is where each test starts, away from both.
function buildCorpus(): Corpus {
  const sutta = (ref: string, node: string, en: string, pali: string, blurb = '') => ({ ref, node, en, pali, blurb, min: 5 });
  return {
    nikayas: [
      { id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 },
      {
        id: 'sn',
        label: 'Linked Discourses',
        sub: 'Saṁyutta Nikāya',
        count: 1,
        chapters: [
          {
            id: 'sn47',
            ref: 'SN47',
            label: 'Establishment of Mindfulness',
            sub: 'Satipaṭṭhānasaṁyutta',
            count: 1,
            chapters: [{ id: 'sn47-ambapalivagga', ref: 'SN47.1', label: 'In Ambapālī’s Mango Grove', sub: 'Ambapālivagga', count: 1 }],
          },
        ],
      },
      {
        id: 'an',
        label: 'Numbered Discourses',
        sub: 'Aṅguttara Nikāya',
        count: 1,
        chapters: [{ id: 'an9-satipatthanavagga', ref: 'AN9.63', label: 'Establishment of Mindfulness', sub: 'Satipaṭṭhānavagga', count: 1 }],
      },
    ],
    suttas: {
      dn1: sutta('DN 1', 'dn', 'The Divine Net', 'Brahmajālasutta'),
      'sn47.1': sutta('SN 47.1', 'sn47-ambapalivagga', 'Ambapālī', 'Ambapālisutta', 'Satipaṭṭhāna as the direct path.'),
      'an9.63': sutta('AN 9.63', 'an9-satipatthanavagga', 'Weakness in Training', 'Sikkhādubbalyasutta'),
    },
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
    searchVersion: 'search-v1',
    dictionaryVersion: 'dict-v1',
  };
}

function mockUserData(lists: ListDef[] = []): ReturnType<typeof useUserData> {
  return {
    ready: true,
    lists,
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
    anchorHighlights: () => {},
    markVisited: () => {},
  };
}

function mockLayout(mobile: boolean) {
  vi.mocked(useLayout).mockReturnValue({
    mobile,
    w: mobile ? 400 : 1200,
    treeW: 264,
    paneW: { tree: 264, treeMax: mobile ? 400 : 600 },
    resetTree: vi.fn(),
    dragTree: vi.fn(),
  });
}

// Renders the Library on `path`, with a way to search from it.
function renderLibrary(path: string) {
  const utils = renderRoutes(
    [
      { path: '/browse/:nodeId/*', element: <LibraryPage key="node" /> },
      { path: '/browse', element: <LibraryPage key="none" /> },
    ],
    path
  );
  const pane = (name: 'TreePane' | 'ListPane') => utils.container.querySelector(`[data-component="${name}"]`) as HTMLElement;
  // Scoped queries: both panes are mounted at once, so the same label can match twice.
  const inPane = (name: 'TreePane' | 'ListPane') => within(pane(name));
  // Which pane a phone shows, read off the wrapper LibraryPage hides the other one with.
  const showing = (name: 'TreePane' | 'ListPane') => pane(name).parentElement!.style.display !== 'none';
  const search = (query: string) => {
    fireEvent.click(inPane('TreePane').getByRole('button', { name: 'Search' }));
    fireEvent.change(inPane('TreePane').getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: query } });
  };
  return { ...utils, pane, inPane, showing, search };
}

// Renders the Library on `path` and types `query` into its search.
function searchFrom(path: string, query: string) {
  const library = renderLibrary(path);
  library.search(query);
  return library;
}

describe('a collection found by search', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    Element.prototype.scrollIntoView = () => {};

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(mockUserData());
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isSignedIn: false,
      dataUserId: 'local-test',
      localUserId: 'local-test',
      loading: false,
      authError: null,
      signingIn: false,
      requestEmailCode: vi.fn(async () => {}),
      signInWithEmailCode: vi.fn(async () => {}),
      signInWithGoogleNative: vi.fn(async () => {}),
      promptGoogleSignIn: vi.fn(),
      logout: vi.fn(async () => {}),
      deleteAccount: vi.fn(async () => {}),
      forgetAccount: vi.fn(async () => {}),
    });
    mockLayout(false);
    vi.mocked(useReaderPrefs).mockReturnValue({
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

  it('shows above the suttas, each row led by its reference, and is counted apart from them', async () => {
    const { inPane } = searchFrom('/browse/dn', 'satipatthana');
    const results = inPane('ListPane');

    expect(await results.findByText('Collections')).toBeTruthy();
    expect(results.getByRole('button', { name: /SN47\s*Establishment of Mindfulness/ })).toBeTruthy();
    expect(results.getByRole('button', { name: /AN9\.63\s*Establishment of Mindfulness/ })).toBeTruthy();
    expect(await results.findByText('1 sutta · 2 collections')).toBeTruthy();
  });

  it("puts the reader's own lists first", async () => {
    vi.mocked(useUserData).mockReturnValue(
      mockUserData([{ id: 'l1', label: 'Satipaṭṭhāna practice', parentId: null, kind: 'list', items: [] }])
    );
    const { inPane } = searchFrom('/browse/dn', 'satipatthana');

    const heading = await inPane('ListPane').findByText('Lists & collections');
    const rows = within(heading.parentElement!).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Satipaṭṭhāna practice'),
      expect.stringContaining('SN47'),
      expect.stringContaining('AN9.63'),
    ]);
  });

  it('opens a collection of suttas on its list, revealed in the tree', async () => {
    const { inPane, pane } = searchFrom('/browse/dn', 'satipatthana');

    fireEvent.click(await inPane('ListPane').findByRole('button', { name: /AN9\.63\s*Establishment/ }));

    expect(await inPane('ListPane').findByText('Weakness in Training')).toBeTruthy();
    expect(pane('TreePane').querySelector('[data-node-id="an9-satipatthanavagga"]')).toBeTruthy();
  });

  it('opens a collection that only expands open in the tree, with no sutta count beside it', async () => {
    const { inPane, pane } = searchFrom('/browse/dn', 'satipatthana');

    fireEvent.click(await inPane('ListPane').findByRole('button', { name: /SN47\s*Establishment/ }));

    await waitFor(() => expect(pane('TreePane').querySelector('[data-node-id="sn47-ambapalivagga"]')).toBeTruthy());
    expect(inPane('ListPane').getByText('Choose a chapter to see its suttas.')).toBeTruthy();
    expect(inPane('ListPane').queryByText('0 suttas')).toBeNull();
  });

  it('reveals a collection picked while already open, its branch collapsed by hand since', async () => {
    const { pane, inPane, search } = renderLibrary('/browse/an9-satipatthanavagga');
    const vaggaRow = () => pane('TreePane').querySelector('[data-node-id="an9-satipatthanavagga"]');
    await waitFor(() => expect(vaggaRow()).toBeTruthy());
    fireEvent.click(pane('TreePane').querySelector('[data-node-id="an"]')!);
    expect(vaggaRow()).toBeNull();

    search('satipatthana');
    fireEvent.click(await inPane('ListPane').findByRole('button', { name: /AN9\.63\s*Establishment/ }));

    await waitFor(() => expect(vaggaRow()).toBeTruthy());
  });

  it('is reached by the arrow keys and opened with Enter', async () => {
    const { inPane } = searchFrom('/browse/dn', 'satipatthana');
    await inPane('ListPane').findByRole('button', { name: /AN9\.63\s*Establishment/ });

    // The cursor starts on the first row, SN47; one step down is AN9's vagga.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(await inPane('ListPane').findByText('Weakness in Training')).toBeTruthy();
  });

  describe('on a phone', () => {
    beforeEach(() => mockLayout(true));

    it('opens a collection of suttas on the list pane', async () => {
      const { inPane, showing } = searchFrom('/browse/dn', 'satipatthana');

      fireEvent.click(await inPane('TreePane').findByRole('button', { name: /AN9\.63\s*Establishment/ }));

      await waitFor(() => expect(showing('ListPane')).toBe(true));
      expect(showing('TreePane')).toBe(false);
      expect(inPane('ListPane').getByText('Weakness in Training')).toBeTruthy();
    });

    it('opens a collection that only expands open in the tree, in place of the results', async () => {
      const { inPane, pane, showing } = searchFrom('/browse/dn', 'satipatthana');

      fireEvent.click(await inPane('TreePane').findByRole('button', { name: /SN47\s*Establishment/ }));

      await waitFor(() => expect(pane('TreePane').querySelector('[data-node-id="sn47-ambapalivagga"]')).toBeTruthy());
      expect(showing('TreePane')).toBe(true);
      expect(showing('ListPane')).toBe(false);
      expect(inPane('TreePane').queryByDisplayValue('satipatthana')).toBeNull();
    });
  });
});
