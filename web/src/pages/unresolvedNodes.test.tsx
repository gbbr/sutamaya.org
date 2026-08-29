import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { Router, navigate } from '@reach/router';

// The states an id can leave a page in when it stops resolving to anything: a /read/ link naming a
// sutta this corpus doesn't have, and a /browse/ node naming a list that is gone. Each one used to
// leave a screen with no title, no explanation and nothing to click — the reader on a permanent
// "Loading…", the library on an untitled "Nothing here yet."
//
// Rendered through the real Router with the contexts mocked, the way
// mobileSearchReaderFlow.test.tsx does — these are about what the pages do with an id, so a real
// browser buys nothing over jsdom here.

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
import { LibraryPage } from './LibraryPage';
import { ReaderPage } from './ReaderPage';
import { NotFoundPage } from './NotFoundPage';
import type { Corpus, ListDef } from '../lib/types';

// DN holds its suttas directly; MN nests a vagga, so `mn` itself is a row that expands rather
// than a page with suttas on it — the shape /browse/mn lands on.
function buildCorpus(): Corpus {
  return {
    nikayas: [
      { id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 },
      {
        id: 'mn',
        label: 'Middle Discourses',
        sub: 'Majjhima Nikāya',
        count: 1,
        chapters: [{ id: 'mn-mulapariyaya', ref: 'MN 1–10', label: 'The Chapter on the Root', count: 1 }],
      },
    ],
    suttas: {
      dn1: { ref: 'DN 1', node: 'dn', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
      mn1: { ref: 'MN 1', node: 'mn-mulapariyaya', en: 'Mulapariyaya', pali: 'Mūlapariyāyasutta', blurb: 'The Root of All Things', min: 5 },
    },
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
    dictionaryVersion: 'dict-v1',
  };
}

const favourites: ListDef = { id: 'l1', label: 'Favourites', parentId: null, kind: 'list', items: ['dn1'] };

function mockUserData(overrides: Partial<ReturnType<typeof useUserData>> = {}): ReturnType<typeof useUserData> {
  return {
    ready: true,
    lists: [favourites],
    membership: { dn1: ['l1'] },
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
    setHighlightRanges: async () => {},
    markVisited: () => {},
    ...overrides,
  };
}

// The routes App.tsx gives these pages, including bare /browse — where a cleared selection lands.
function renderApp(path: string) {
  navigate(path);
  const utils = render(
    <Router style={{ height: '100%' }}>
      <LibraryPage path="/browse/:nodeId/*suttaId" />
      <LibraryPage path="/browse" />
      <ReaderPage path="/read/:suttaId" />
      <NotFoundPage default />
    </Router>
  );
  const pane = (name: 'TreePane' | 'ListPane' | 'ReaderPage') => utils.container.querySelector(`[data-component="${name}"]`);
  // Scoped queries: both panes are mounted at once, so the same label can match twice.
  return { ...utils, pane, inPane: (name: 'TreePane' | 'ListPane') => within(pane(name) as HTMLElement) };
}

describe('an id that no longer resolves to anything', () => {
  beforeEach(() => {
    // Node's own experimental global localStorage shadows jsdom's in a way that throws on access;
    // both pages genuinely round-trip through it (pane choice, last reader origin), so stub a
    // plain in-memory store — same workaround as mobileSearchReaderFlow.test.tsx.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(mockUserData());
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
      paneW: { tree: 264, treeMax: 600 },
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
      showHighlights: true,
      setTheme: vi.fn(),
      setFs: vi.fn(),
      setLh: vi.fn(),
      setFace: vi.fn(),
      toggleAllPali: vi.fn(),
      toggleShowNotes: vi.fn(),
      toggleShowHighlights: vi.fn(),
      revealHighlights: vi.fn(),
      cycleTheme: vi.fn(),
    });
  });

  it('says so for a /read/ link naming a sutta this corpus does not have', async () => {
    // A shared link with a typo, or a bookmark from before a corpus refresh renamed the uid. The
    // reader used to sit on its "Loading…" placeholder for good: no title, no close button, no
    // keyboard way out — and /app restores the last location, so relaunching came straight back
    // to it.
    renderApp('/read/dn9999');

    expect(await screen.findByText("This page doesn't exist.")).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to the library/ })).toBeTruthy();
  });

  it('still opens a sutta the corpus does have', async () => {
    const { pane } = renderApp('/read/dn1');

    await waitFor(() => expect(pane('ReaderPage')).toBeTruthy());
    expect(screen.queryByText("This page doesn't exist.")).toBeNull();
  });

  it('says a list is gone rather than showing it as empty', async () => {
    // Deleted here, deleted on another device, or a link that has outlived it — one screen for
    // all three, since nothing navigates away on a delete. The pane used to be titled with
    // nothing, count 0 suttas and say "Nothing here yet." — the same screen an empty list shows.
    const { inPane } = renderApp('/browse/no-such-id');

    expect(await inPane('ListPane').findByText('This list is no longer here.')).toBeTruthy();
    // "0 suttas" would read as an empty list rather than an absent one.
    expect(inPane('ListPane').queryByText('0 suttas')).toBeNull();
  });

  it('leaves a real, still-existing list alone', async () => {
    const { inPane } = renderApp('/browse/l1');

    expect(await inPane('ListPane').findByText('Favourites')).toBeTruthy();
    expect(inPane('ListPane').queryByText('This list is no longer here.')).toBeNull();
  });

  it('waits for the mirror before calling a list id gone', async () => {
    // `ready: false` is "the local dataset is not known yet", not "there are no lists" — a deep
    // link to a list must not be written off during the window before the mirror loads.
    vi.mocked(useUserData).mockReturnValue(mockUserData({ ready: false, lists: [], membership: {} }));
    const { inPane } = renderApp('/browse/l1');

    await new Promise((r) => setTimeout(r, 0));
    expect(inPane('ListPane').queryByText('This list is no longer here.')).toBeNull();
  });

  it('tells a corpus row that only expands what to do instead of calling it empty', async () => {
    // /browse/mn is a real node with real suttas under it, just not directly — nothing in the UI
    // links there, but a typed or shared URL does. "Nothing here yet." reads as "MN is empty".
    const { inPane } = renderApp('/browse/mn');

    expect(await inPane('ListPane').findByText('Middle Discourses')).toBeTruthy();
    expect(inPane('ListPane').getByText('Choose a chapter to see its suttas.')).toBeTruthy();
  });
});
