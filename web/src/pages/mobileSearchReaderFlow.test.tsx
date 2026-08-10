import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Router, navigate } from '@reach/router';

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

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { LibraryPage } from './LibraryPage';
import { ReaderPage } from './ReaderPage';
import type { Corpus } from '../lib/types';

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
  };
}

const userDataDefaults: ReturnType<typeof useUserData> = {
  ready: true,
  lists: [],
  membership: {},
  notes: {},
  highlights: {},
  visited: {},
  listMembers: () => [],
  createList: async () => {
    throw new Error('unused');
  },
  renameList: async () => {},
  removeList: async () => {},
  setListParent: async () => {},
  reorderLists: async () => {},
  reorderListItems: async () => {},
  toggleMembership: async () => {},
  addToList: async () => {},
  submitNote: async () => {},
  setHighlightRanges: async () => {},
  removeHighlights: async () => {},
  markVisited: () => {},
  syncUserData: async () => {},
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

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), dictionary: null, loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(userDataDefaults);
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      googleReady: true,
      authError: null,
      loginWithGoogle: vi.fn(async () => {}),
      promptGoogleSignIn: vi.fn(),
      logout: vi.fn(async () => {}),
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
      showNotes: true,
      setTheme: vi.fn(),
      setFs: vi.fn(),
      setLh: vi.fn(),
      setFace: vi.fn(),
      toggleAllPali: vi.fn(),
      toggleShowNotes: vi.fn(),
    });
  });

  it('returns to the searched sutta\'s own tree location, not the stale pre-search category', async () => {
    navigate('/browse/dn');
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
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
    const input = tree().getByPlaceholderText('Search ID, title, blurb, note, text');
    fireEvent.change(input, { target: { value: 'Mulapariyaya' } });

    const hit = await tree().findByText('Mulapariyaya');
    fireEvent.click(hit);

    // Now in the reader for mn1.
    await waitFor(() => expect(screen.getByText(/MN 1/)).toBeTruthy());

    // Close the reader.
    fireEvent.click(screen.getByTitle('Close'));

    // Should land back on the tree pane, expanded/scrolled to MN (mn1's own node) — not DN,
    // the category that happened to be browsed before the search.
    await screen.findByText('sutamaya');
    const mnRow = tree().getByRole('button', { name: /Middle Discourses/ });
    expect(mnRow.className).toContain('bg-ink/[.06]');
    const dnRow = tree().getByRole('button', { name: /Long Discourses/ });
    expect(dnRow.className).not.toContain('bg-ink/[.06]');
  });

  it("keeps TreePane on 'My lists' after a search result is opened and the reader is closed", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'reader@example.com', name: 'Reader', picture: null },
      loading: false,
      googleReady: true,
      authError: null,
      loginWithGoogle: vi.fn(async () => {}),
      promptGoogleSignIn: vi.fn(),
      logout: vi.fn(async () => {}),
    });
    vi.mocked(useUserData).mockReturnValue({
      ...userDataDefaults,
      lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] }],
    });

    navigate('/browse/dn');
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);

    // Switch TreePane's own Library <-> My lists toggle to "My lists" — this doesn't touch
    // `nodeId` at all, which stays 'dn' (wherever was browsed before).
    fireEvent.click(await tree().findByRole('button', { name: 'Switch to My Lists' }));
    expect(tree().getByText('Favorites')).toBeTruthy();

    // Search (still visible/usable regardless of the Library/My-lists toggle) and open a hit —
    // an ordinary corpus sutta, not a member of "Favorites".
    fireEvent.click(tree().getByRole('button', { name: 'Search' }));
    fireEvent.change(tree().getByPlaceholderText('Search ID, title, blurb, note, text'), {
      target: { value: 'Mulapariyaya' },
    });
    fireEvent.click(await tree().findByText('Mulapariyaya'));
    await waitFor(() => expect(screen.getByText(/MN 1/)).toBeTruthy());

    // Close the reader — should land back on "My lists", not get bounced to the corpus tree just
    // because the reopened sutta's own node ('mn') happens to be a real corpus category.
    fireEvent.click(screen.getByTitle('Close'));
    await screen.findByText('sutamaya');
    expect(tree().getByText('Favorites')).toBeTruthy();
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
  // to the manual switch. A same-tab refresh preserves history.state (unlike a fresh
  // navigation), so simulating one here means unmounting and re-rendering a fresh <Router> against
  // the *same*, unchanged location — no navigate() call in between — the same way a real F5
  // leaves the URL and its history.state exactly as they were.
  it('a manual pane switch after closing the reader survives a simulated refresh', async () => {
    navigate('/browse/dn');
    const { container, unmount } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
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

    // Simulated refresh: fresh mount, same (now-stale) location/history.state, no navigate().
    unmount();
    const remounted = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
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
    navigate('/browse/dn');
    const { container, unmount } = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    const tree = () => within(container.querySelector('[data-component="TreePane"]')!);

    fireEvent.click(tree().getByRole('button', { name: /Long Discourses/ }));
    fireEvent.click(await screen.findByText('Brahmajala'));
    await waitFor(() => expect(container.querySelector('[data-component="ReaderPage"]')).toBeTruthy());

    // Simulated refresh while still on /read/dn1: unmount, then re-navigate to the same path with
    // no `state` at all (mirroring what a real hard refresh leaves behind), and remount fresh.
    unmount();
    navigate('/read/dn1', { replace: true });
    const remounted = render(
      <Router style={{ height: '100%' }}>
        <LibraryPage path="/browse/:nodeId/*suttaId" />
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    await waitFor(() => expect(remounted.container.querySelector('[data-component="ReaderPage"]')).toBeTruthy());

    fireEvent.click(remounted.getByTitle('Close'));

    // Falls back to the persisted origin (list pane, dn1's own row) rather than the coarser
    // /browse/{node}/{suttaId} default.
    await remounted.findByText('sutamaya');
    expect(isPaneVisible(remounted.container, 'ListPane')).toBe(true);
    expect(remounted.getByText('Brahmajala')).toBeTruthy();
  });
});
