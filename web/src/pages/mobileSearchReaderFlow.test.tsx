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
      loginWithGoogle: vi.fn(async () => {}),
      promptGoogleSignIn: vi.fn(),
      logout: vi.fn(async () => {}),
    });
    vi.mocked(useLayout).mockReturnValue({
      mobile: true,
      twoPane: false,
      desktop: false,
      w: 400,
      treeW: 264,
      paneW: { tree: 264, treeMax: 400 },
      resetTree: vi.fn(),
      dragTree: vi.fn(),
    });
    vi.mocked(useReaderPrefs).mockReturnValue({
      theme: 'light',
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
});
