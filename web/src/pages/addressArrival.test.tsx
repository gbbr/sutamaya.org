import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderRoutes } from '../testRouter';
import { RouterView } from '../components/RouterView';

// Covers an address opened in the browser — typed, pasted or followed from another site — naming
// the collection the library was last left on.

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));
vi.mock('../lib/entryKind', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/entryKind')>()),
  takeAddressArrival: vi.fn(() => true),
}));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { takeAddressArrival } from '../lib/entryKind';
import { LibraryPage } from './LibraryPage';
import { TREE_EXPANDED_KEY } from '../lib/storageKeys';
import { SEARCH_PLACEHOLDER } from '../lib/search/metadata';
import type { Corpus } from '../lib/types';

const routes = [
  { path: '/browse/:nodeId/*', element: <LibraryPage key="node" /> },
  { path: '/browse', element: <LibraryPage key="none" /> },
];

// DN is a collection of chapters.
const corpus: Corpus = {
  nikayas: [
    {
      id: 'dn',
      label: 'Long Discourses',
      sub: 'Dīgha Nikāya',
      count: 1,
      chapters: [{ id: 'dn-silakkhandhavagga', ref: 'DN 1–13', label: 'The Chapter on Ethics', count: 1 }],
    },
  ],
  suttas: {
    dn1: { ref: 'DN 1', node: 'dn-silakkhandhavagga', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
  },
  sujatoCommit: 'abc1234',
  dataVersion: 'data-v1',
  searchVersion: 'search-v1',
  dictionaryVersion: 'dict-v1',
};

beforeEach(() => {
  // An in-memory store, since Node's own global `localStorage` throws on every access here.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

  vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
  mockUserData(true);
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
    signInWithAppleNative: vi.fn(async () => false),
    promptGoogleSignIn: vi.fn(),
    logout: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    forgetAccount: vi.fn(async () => {}),
  });
  vi.mocked(useLayout).mockReturnValue({
    mobile: false,
    w: 1200,
    treeW: 264,
    paneW: { tree: 264, treeMax: 400 },
    resetTree: vi.fn(),
    dragTree: vi.fn(),
  });
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Serves the reader's saved data, `ready` once it has loaded from the device.
function mockUserData(ready: boolean) {
  vi.mocked(useUserData).mockReturnValue({
    ready,
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
    anchorHighlights: () => {},
    markVisited: () => {},
  });
}

describe('an address naming the collection last browsed', () => {
  it('opens that collection in the tree, after it was closed there', async () => {
    // DN, left closed on the tree, with nothing else browsed since.
    localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify({ corpus: [], lists: [], node: 'dn' }));
    const { container } = renderRoutes(routes, '/browse/dn');
    await screen.findByText('sutamaya');

    const tree = within(container.querySelector<HTMLElement>('[data-component="TreePane"]')!);
    expect(tree.getByText('The Chapter on Ethics')).toBeTruthy();
    // Asked about the location the page loaded on.
    expect(takeAddressArrival).toHaveBeenCalledWith('default');
  });

  it('centres and highlights that collection, as a collection found by search is', async () => {
    // Each scroll into view, as the row's node id and the position asked for, e.g. "dn center".
    const scrolls: string[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
      arg?: boolean | ScrollIntoViewOptions
    ) {
      scrolls.push(`${this.getAttribute('data-node-id')} ${typeof arg === 'object' ? arg.block : arg}`);
    });
    localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify({ corpus: [], lists: [], node: 'dn' }));
    const { container } = renderRoutes(routes, '/browse/dn');
    await screen.findByText('sutamaya');

    expect(scrolls.at(-1)).toBe('dn center');
    const row = container.querySelector('[data-component="TreePane"] [data-node-id="dn"]')!;
    expect(row.className).toContain('bg-accent/[.15]');
  });

  it('centres that collection once a search shown over it closes, and not on some later change', async () => {
    const scrolls: string[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
      arg?: boolean | ScrollIntoViewOptions
    ) {
      scrolls.push(`${this.getAttribute('data-node-id')} ${typeof arg === 'object' ? arg.block : arg}`);
    });
    const { router, rerender } = renderRoutes(routes, '/browse/dn-silakkhandhavagga?q=Brahmajala');
    const input = await screen.findByPlaceholderText(SEARCH_PLACEHOLDER);
    expect(scrolls).toEqual([]);

    fireEvent.change(input, { target: { value: '' } });
    expect(scrolls).toEqual(['dn-silakkhandhavagga center']);

    // The saved data changing afterwards, as a sync does.
    mockUserData(true);
    rerender(<RouterView router={router} />);
    expect(scrolls).toEqual(['dn-silakkhandhavagga center']);
  });

  it('keeps that collection in view once the saved data has loaded', async () => {
    // Scrolling to a row moves the tree's column, so a remembered offset put back afterwards shows.
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      this.closest<HTMLElement>('.sc')!.scrollTop = 432;
    });
    localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify({ corpus: [], lists: [], node: 'dn' }));
    mockUserData(false);
    const { container, router, rerender } = renderRoutes(routes, '/browse/dn');
    await screen.findByText('sutamaya');

    mockUserData(true);
    rerender(<RouterView router={router} />);
    expect(container.querySelector<HTMLElement>('[data-component="TreePane"] .sc')!.scrollTop).toBe(432);
  });
});
