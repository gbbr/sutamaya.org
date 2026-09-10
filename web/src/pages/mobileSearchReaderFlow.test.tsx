import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderRoutes } from '../testRouter';

// Reproduces (and guards against regressing) a mobile-only bug: switching between the tree/list
// pane, then opening a *search* result into the reader, then closing the reader again used to
// land back on whatever category was browsed *before* the search — not the opened sutta's own
// location — because LibraryPage's `onOpen` built its `from` return-URL from the currently
// browsed `nodeId` unconditionally, even though a search hit isn't necessarily a member of it.
// See LibraryPage.tsx's `onOpen` for the fix.

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../context/ReaderPrefsContext', () => ({ useReaderPrefs: vi.fn() }));
// LibraryPage reads it only for the Shift+D theme toggle; the real provider isn't mounted here.
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { LibraryPage } from './LibraryPage';
import { ReaderPage } from './ReaderPage';
import { SEARCH_PLACEHOLDER } from '../lib/search/metadata';
import { LIBRARY_VIEW_KEY } from '../lib/storageKeys';
import { tagIntent } from '../lib/routeIntent';
import type { Corpus } from '../lib/types';

// The pages a reader round trip crosses, routed as App.tsx routes them — the library with nothing
// selected keyed apart from the library on a node, so picking the first node remounts the page
// there too.
const routes = [
  { path: '/browse/:nodeId/*', element: <LibraryPage key="node" /> },
  { path: '/browse', element: <LibraryPage key="none" /> },
  { path: '/read/:suttaId', element: <ReaderPage /> },
];

function buildCorpus(): Corpus {
  return {
    nikayas: [
      { id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 },
      { id: 'mn', label: 'Middle Discourses', sub: 'Majjhima Nikāya', count: 1 },
    ],
    suttas: {
      dn1: { ref: 'DN 1', node: 'dn', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
      mn1: { ref: 'MN 1', node: 'mn', en: 'Mulapariyaya', pali: 'Mūlapariyāyasutta', blurb: 'The Root of All Things', min: 5 },
    },
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
  anchorHighlights: () => {},
  markVisited: () => {},
};

describe('mobile search -> reader -> close flow', () => {
  beforeEach(() => {
    // Node 26's own experimental global `localStorage` shadows jsdom's implementation here in a
    // way that makes it throw on every access rather than actually storing anything — the app's
    // own TreePane/LibraryPage round-trip (persist paneView/view choices, read them back on the
    // next mount) genuinely depends on a working store, so stub a plain in-memory one rather than
    // just letting every call throw (which every call site already tolerates, but would silently
    // defeat what the second test below is specifically checking).
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

  it('returns to the collection that was being browsed, not the opened hit\'s own', async () => {
    const { container } = renderRoutes(routes, '/browse/dn');
    // TreePane and ListPane are both always mounted on mobile (one hidden via display:none — see
    // LibraryPage), so plain `screen` queries can match the same label in both; scope to
    // TreePane specifically wherever a query would otherwise be ambiguous.
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);

    // Confirm we're on the tree pane, browsing DN.
    expect(await screen.findByText('sutamaya')).toBeTruthy();

    // "Switching between tree/list pane": select DN (-> list pane), then go Back (-> tree pane).
    fireEvent.click(tree().getByRole('button', { name: /Long Discourses/ }));
    expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('sutamaya');

    // Open search and search for the MN sutta while DN is still the browsed nodeId.
    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    const input = tree().getByPlaceholderText(SEARCH_PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'Mulapariyaya' } });

    const hit = await tree().findByText('Mulapariyaya');
    fireEvent.click(hit);

    // Now in the reader for mn1.
    // Waited for on the reader's own chrome: the hit row behind it carries "MN 1" too, so a text
    // query would pass before the route had changed.
    await screen.findByTitle('Close');

    // Close the reader.
    fireEvent.click(screen.getByTitle('Close'));

    // Should land back on the tree pane, still on DN — the collection being browsed when the
    // search started, which the search itself never moved. Opening MN 1 from the results doesn't
    // re-scope the tree to MN. The results come back with the close, so the tree is behind them
    // until the search is cleared.
    await screen.findByText('sutamaya');
    fireEvent.click(tree().getByRole('button', { name: 'Clear search' }));
    const dnRow = tree().getByRole('button', { name: /Long Discourses/ });
    expect(dnRow.className).toContain('bg-ink/[.06]');
    const mnRow = tree().getByRole('button', { name: /Middle Discourses/ });
    expect(mnRow.className).not.toContain('bg-ink/[.06]');
  });

  it("keeps TreePane on 'My lists' after a search result is opened and the reader is closed", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'reader@example.com', name: 'Reader', picture: null },
      isSignedIn: true,
      dataUserId: 'u1',
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
    vi.mocked(useUserData).mockReturnValue({
      ...userDataDefaults,
      lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] }],
    });

    const { container } = renderRoutes(routes, '/browse/dn');
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);

    // Switch TreePane's own Library <-> My lists tabs to "My lists" — this doesn't touch
    // `nodeId` at all, which stays 'dn' (wherever was browsed before).
    fireEvent.click(await tree().findByRole('button', { name: 'Lists' }));
    expect(tree().getByText('Favorites')).toBeTruthy();

    // Search (still visible/usable regardless of the Library/My-lists toggle) and open a hit —
    // an ordinary corpus sutta, not a member of "Favorites".
    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    fireEvent.change(tree().getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: 'Mulapariyaya' },
    });
    fireEvent.click(await tree().findByText('Mulapariyaya'));
    // Waited for on the reader's own chrome: the hit row behind it carries "MN 1" too, so a text
    // query would pass before the route had changed.
    await screen.findByTitle('Close');

    // Close the reader — should land back on "My lists", not get bounced to the corpus tree just
    // because the reopened sutta's own node ('mn') happens to be a real corpus category. The
    // results come back with the close, so the tabs are behind them until the search is cleared.
    fireEvent.click(screen.getByTitle('Close'));
    await screen.findByText('sutamaya');
    fireEvent.click(tree().getByRole('button', { name: 'Clear search' }));
    expect(tree().getByText('Favorites')).toBeTruthy();
  });

  it('closing a search result returns to the results, on the row it was opened from', async () => {
    const { container, router } = renderRoutes(routes, '/browse/dn');
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);
    await screen.findByText('sutamaya');

    // A query both suttas match, so the second one can't be the row the cursor starts on anyway.
    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    fireEvent.change(tree().getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'sutta' } });
    fireEvent.click(await tree().findByText('Mulapariyaya'));
    // Waited for on the reader's own chrome: the hit row behind it carries "MN 1" too, so a text
    // query would pass before the route had changed.
    await screen.findByTitle('Close');

    fireEvent.click(screen.getByTitle('Close'));
    await screen.findByText('sutamaya');

    // The query is in the address bar and back in the box, with the results below it.
    expect(router.state.location.search).toBe('?q=sutta');
    expect((tree().getByPlaceholderText(SEARCH_PLACEHOLDER) as HTMLInputElement).value).toBe('sutta');
    // The opened hit is the marked row, not the first one.
    expect(tree().getByText('Mulapariyaya').closest('button')!.className).toContain('bg-ink/[.06]');
    expect(tree().getByText('Brahmajala').closest('button')!.className).not.toContain('bg-ink/[.06]');
  });

  // TreePane and ListPane are both *always* mounted on mobile (LibraryPage toggles `display:none`
  // on the inactive one rather than unmounting it — see LibraryPage.tsx), so which one is
  // "showing" has to be read off that wrapper's inline style, not off either pane's mere presence
  // in the DOM.
  function isPaneVisible(container: HTMLElement, component: 'TreePane' | 'ListPane') {
    const el = container.querySelector(`[data-component="${component}"]`);
    return (el?.parentElement as HTMLElement | null)?.style.display !== 'none';
  }

  // Regression test for 729d0be9 ("Fix mobile library refresh reverting tree->list toggle"): a
  // reader-close round trip carries `fromView` back in router state; ListPane's mobile "Back"
  // button then flips the pane locally *without* navigating, so that state is left stale relative
  // to the manual switch. A same-tab refresh restores the whole history entry — its state, and the
  // key the router stored alongside it — so simulating one here means unmounting and starting a
  // fresh router on the entry the old one ended on, with no navigation in between, the same way a
  // real F5 leaves the URL and its history entry exactly as they were.
  it('a manual pane switch after closing the reader survives a simulated refresh', async () => {
    const { container, unmount, router } = renderRoutes(routes, '/browse/dn');
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);

    // Browse into DN (-> list pane), open its sutta, then close the reader — round trips back
    // with fromView: 'list' baked into this history entry's state.
    fireEvent.click(tree().getByRole('button', { name: /Long Discourses/ }));
    fireEvent.click(await screen.findByText('Brahmajala'));
    // Not `getByText(/DN 1/)` — the list row just clicked already shows that same ref text, so
    // that assertion would pass without ever waiting for the reader to actually open.
    await waitFor(() => expect(container.querySelector('[data-component="ReaderPage"]')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Close'));
    await screen.findByText('sutamaya');
    expect(isPaneVisible(container, 'ListPane')).toBe(true); // back on the list pane

    // Manual switch, purely local (no navigate()) — this is exactly what leaves the state above
    // stale.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(isPaneVisible(container, 'TreePane')).toBe(true);
    expect(isPaneVisible(container, 'ListPane')).toBe(false);

    // Simulated refresh: fresh router on the same (now-stale) history entry, no navigation.
    const entry = router.state.location;
    unmount();
    const remounted = renderRoutes(routes, entry);
    await remounted.findByText('sutamaya');

    // Must still show the tree pane — a revert back to 'list' here is exactly the bug.
    expect(isPaneVisible(remounted.container, 'TreePane')).toBe(true);
    expect(isPaneVisible(remounted.container, 'ListPane')).toBe(false);
  });

  // A hard refresh while the reader is open drops location.state entirely (browser-native — a
  // fresh navigation's history entry starts with none), losing the `from`/`fromView` that
  // closeReader would normally use to return to the exact pane it was opened from — see
  // ReaderPage's readPersistedReaderOrigin fallback, which LibraryPage.onOpen persists alongside
  // the router state it also sets.
  it("closing the reader falls back to the persisted origin when location.state was lost (refresh)", async () => {
    const { container, unmount } = renderRoutes(routes, '/browse/dn');
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);

    fireEvent.click(tree().getByRole('button', { name: /Long Discourses/ }));
    fireEvent.click(await screen.findByText('Brahmajala'));
    await waitFor(() => expect(container.querySelector('[data-component="ReaderPage"]')).toBeTruthy());

    // Simulated refresh while still on /read/dn1: unmount, then start a fresh router on that same
    // address as a bare path — no `state` at all, mirroring what a real hard refresh leaves behind.
    unmount();
    const remounted = renderRoutes(routes, '/read/dn1');
    await waitFor(() => expect(remounted.container.querySelector('[data-component="ReaderPage"]')).toBeTruthy());

    fireEvent.click(remounted.getByTitle('Close'));

    // Falls back to the persisted origin (list pane, dn1's own row) rather than the coarser
    // /browse/{node}/{suttaId} default.
    await remounted.findByText('sutamaya');
    expect(isPaneVisible(remounted.container, 'ListPane')).toBe(true);
    expect(remounted.getByText('Brahmajala')).toBeTruthy();
  });

  // The first collection picked on a first visit, which crosses from the library with nothing
  // selected to the library on a node — a different page, so the one showing the tree goes and a
  // fresh one arrives, and the list is what the pick asked for.
  it('shows the list pane for the first collection picked from a bare /browse', async () => {
    const { container } = renderRoutes(routes, '/browse');
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);

    fireEvent.click(await tree().findByRole('button', { name: /Long Discourses/ }));

    await waitFor(() => expect(isPaneVisible(container, 'ListPane')).toBe(true));
    expect(isPaneVisible(container, 'TreePane')).toBe(false);
    expect(within(container.querySelector('[data-component="ListPane"]')!).getByText('Brahmajala')).toBeTruthy();
  });

  // Which pane the Library opens on when the address already names a sutta. The entry a tab opens
  // on is one no navigation in the app made — a shared link, a bookmark, a typed URL — and only
  // the list pane shows the row it names.
  it('opens the list pane for a shared link naming a sutta', async () => {
    localStorage.setItem(LIBRARY_VIEW_KEY, 'tree');
    const { container } = renderRoutes(routes, '/browse/dn/dn1');
    await screen.findByText('sutamaya');

    // The list pane, over the tree the reader was last left on.
    expect(isPaneVisible(container, 'ListPane')).toBe(true);
    expect(isPaneVisible(container, 'TreePane')).toBe(false);
    expect(within(container.querySelector('[data-component="ListPane"]')!).getByText('Brahmajala')).toBeTruthy();
  });

  // The same address reached from inside the app instead, where the pane the reader is on is a
  // choice they made and the arrival doesn't overrule it.
  it('keeps the pane in use when a sutta address is reached from inside the app', async () => {
    localStorage.setItem(LIBRARY_VIEW_KEY, 'tree');
    // Mounted on the reader, so the Library's own mount is the arrival under test.
    const { container, router } = renderRoutes(routes, '/read/dn1');
    await waitFor(() => expect(container.querySelector('[data-component="ReaderPage"]')).toBeTruthy());

    await act(() => router.navigate('/browse/dn/dn1'));
    await screen.findByText('sutamaya');
    expect(isPaneVisible(container, 'TreePane')).toBe(true);
    expect(isPaneVisible(container, 'ListPane')).toBe(false);
  });

  // The pane an arrival opens on is remembered like one picked by hand, so a relaunch into the
  // same place — "/" restoring it, which names no pane — opens on it again.
  it('remembers the pane an arrival opened on', async () => {
    localStorage.setItem(LIBRARY_VIEW_KEY, 'tree');
    // What a list chip in the reader sends.
    const { container } = renderRoutes(routes, { pathname: '/browse/dn/dn1', state: tagIntent({ fromView: 'list' }) });
    await screen.findByText('sutamaya');

    expect(isPaneVisible(container, 'ListPane')).toBe(true);
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe('list');
  });
});
