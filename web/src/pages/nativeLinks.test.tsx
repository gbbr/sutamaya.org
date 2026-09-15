import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from 'react-router';
import { renderRoutes, type RouteEntry } from '../testRouter';

// Covers where a link opened in another app lands in the phone app, from each place the app can
// already be.

// The link event as useNativeLinks subscribes to it.
const links = vi.hoisted(() => ({ open: (_event: { url: string }) => {} }));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, cb: (event: { url: string }) => void) => {
      if (event === 'appUrlOpen') links.open = cb;
      return { remove: () => {} };
    },
    getLaunchUrl: async () => undefined,
  },
}));
vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../context/ReaderPrefsContext', () => ({ useReaderPrefs: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useNativeLinks } from '../hooks/useNativeLinks';
import { LibraryPage } from './LibraryPage';
import { ReaderPage } from './ReaderPage';
import { LIBRARY_VIEW_KEY } from '../lib/storageKeys';
import type { Corpus } from '../lib/types';

function Shell() {
  useNativeLinks();
  return <Outlet />;
}

// The pages a link can land on, routed as App.tsx routes them.
const routes = [
  {
    element: <Shell />,
    children: [
      { path: '/browse/:nodeId/*', element: <LibraryPage key="node" /> },
      { path: '/browse', element: <LibraryPage key="none" /> },
      { path: '/read/:suttaId', element: <ReaderPage /> },
    ],
  },
];

// DN is a collection of chapters; MN holds its suttas directly.
const corpus: Corpus = {
  nikayas: [
    {
      id: 'dn',
      label: 'Long Discourses',
      sub: 'Dīgha Nikāya',
      count: 1,
      chapters: [{ id: 'dn-silakkhandhavagga', ref: 'DN 1–13', label: 'The Chapter on Ethics', count: 1 }],
    },
    { id: 'mn', label: 'Middle Discourses', sub: 'Majjhima Nikāya', count: 1 },
  ],
  suttas: {
    dn1: { ref: 'DN 1', node: 'dn-silakkhandhavagga', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
    mn1: { ref: 'MN 1', node: 'mn', en: 'Mulapariyaya', pali: 'Mūlapariyāyasutta', blurb: 'The Root of All Things', min: 5 },
  },
  sujatoCommit: 'abc1234',
  dataVersion: 'data-v1',
  searchVersion: 'search-v1',
  dictionaryVersion: 'dict-v1',
};

// Renders the iOS app on `entry`, with the Library last left on `pane`.
function openApp(entry: RouteEntry, pane: 'tree' | 'list' = 'tree') {
  localStorage.setItem(LIBRARY_VIEW_KEY, pane);
  return renderRoutes(routes, entry);
}

// Whether the Library pane is on screen: both stay mounted on a phone, the hidden one inside a
// `display: none` wrapper.
function paneShown(container: HTMLElement, pane: 'TreePane' | 'ListPane') {
  const wrapper = container.querySelector(`[data-component="${pane}"]`)?.parentElement;
  return !!wrapper && wrapper.style.display !== 'none';
}

// Taps a link to `path` in another app.
async function tapLink(path: string) {
  await act(async () => links.open({ url: `https://app.sutamaya.org${path}` }));
}

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
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };

  vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
  vi.mocked(useUserData).mockReturnValue({
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
    anchorHighlights: () => {},
    markVisited: () => {},
  });
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
  vi.mocked(useLayout).mockReturnValue({
    mobile: true,
    w: 400,
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

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('a link opened in the phone app', () => {
  it("opens a collection's contents while the Library shows the tree", async () => {
    const { container, router } = openApp('/browse/dn');
    await screen.findByText('sutamaya');
    expect(paneShown(container, 'TreePane')).toBe(true);

    await tapLink('/browse/mn');
    expect(router.state.location.pathname).toBe('/browse/mn');
    expect(paneShown(container, 'ListPane')).toBe(true);
    expect(paneShown(container, 'TreePane')).toBe(false);
  });

  it('opens the contents of the collection the reader backed out to the tree from', async () => {
    const { container } = openApp('/browse/mn');
    await screen.findByText('sutamaya');

    await tapLink('/browse/mn');
    expect(paneShown(container, 'ListPane')).toBe(true);
  });

  it("closes a search to show the collection's contents", async () => {
    const { container, router } = openApp('/browse/dn?q=Brahmajala');
    await screen.findByText('sutamaya');

    await tapLink('/browse/mn');
    const list = within(container.querySelector<HTMLElement>('[data-component="ListPane"]')!);
    expect(paneShown(container, 'ListPane')).toBe(true);
    expect(await list.findByText('Mulapariyaya')).toBeTruthy();
    // Past the pause after which a search is written to the address.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(router.state.location.search).toBe('');
  });

  it("opens a sutta's collection on its contents from the Reader", async () => {
    const { container, router } = openApp('/read/mn1');
    await screen.findByTitle('Close');

    await tapLink('/browse/dn-silakkhandhavagga/dn1');
    await waitFor(() => expect(paneShown(container, 'ListPane')).toBe(true));
    expect(router.state.location.pathname).toBe('/browse/dn-silakkhandhavagga/dn1');
  });

  it('opens a collection of chapters on the tree', async () => {
    const { container } = openApp('/browse/mn', 'list');
    await screen.findByText('sutamaya');
    expect(paneShown(container, 'ListPane')).toBe(true);

    await tapLink('/browse/dn');
    expect(paneShown(container, 'TreePane')).toBe(true);
  });

  it('opens the Library itself on the tree', async () => {
    const { container } = openApp('/browse/mn', 'list');
    await screen.findByText('sutamaya');

    await tapLink('/browse');
    await waitFor(() => expect(paneShown(container, 'TreePane')).toBe(true));
  });

  it('opens a shared sutta while the Reader shows another', async () => {
    openApp('/read/mn1');
    await screen.findByTitle('Close');

    await tapLink('/read/dn1');
    await waitFor(() => expect(document.title).toContain('DN 1'));
  });
});
