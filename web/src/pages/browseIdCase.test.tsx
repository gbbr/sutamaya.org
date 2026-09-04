import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import { Router, globalHistory, navigate } from '@reach/router';

// What a `/browse` segment's capitalization is allowed to mean. A corpus id is a reference someone
// types or shares with the capitals the app displays ("SN 12.1"), so it is case-folded and the
// address bar settles on the canonical lowercase path. A list id is opaque — minted, never written
// down — and folding one names a different list, or none at all: lists made before the app switched
// to UUIDs carry mixed-case ids, and lowercasing theirs left the pane saying "This list is no
// longer here" and the URL rewritten out from under a working link.

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { LibraryPage } from './LibraryPage';
import type { Corpus, ListDef } from '../lib/types';

function buildCorpus(): Corpus {
  return {
    nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
    suttas: {
      dn1: { ref: 'DN 1', node: 'dn', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
    },
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
    searchVersion: 'search-v1',
    dictionaryVersion: 'dict-v1',
  };
}

// A Firestore-era id: 20 characters of mixed-case base62, as every list made before the switch to
// crypto.randomUUID() still carries.
const LEGACY_ID = 'KMcwl8njDkaIwZcl2Mp5';
const favourites: ListDef = { id: LEGACY_ID, label: 'Favourites', parentId: null, kind: 'list', items: ['dn1'] };

// Only the fields this page reads. Cast rather than spelled out in full: the mutators are beside
// the point here, and naming every one would tie this file to whatever the context's shape is that
// week.
function mockUserData() {
  return {
    ready: true,
    lists: [favourites],
    membership: { dn1: [LEGACY_ID] },
    notes: {},
    highlights: {},
    visited: {},
    syncStatus: 'synced' as const,
    pendingCount: 0,
    lastSyncedAt: null,
    needsReauth: false,
    listMembers: () => [],
    reorderListItems: async () => {},
    markVisited: () => {},
  } as unknown as ReturnType<typeof useUserData>;
}

function renderAt(path: string) {
  navigate(path);
  const utils = render(
    <Router style={{ height: '100%' }}>
      <LibraryPage path="/browse/:nodeId/*suttaId" />
      <LibraryPage path="/browse" />
    </Router>
  );
  const pane = utils.container.querySelector('[data-component="ListPane"]') as HTMLElement;
  return { ...utils, inListPane: within(pane) };
}

describe('capitalization in a /browse id', () => {
  beforeEach(() => {
    // Node's own experimental global localStorage shadows jsdom's in a way that throws on access,
    // and this page round-trips through it (pane choice, reader origin) — same in-memory stub the
    // other page tests use.
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
  });

  it('opens a list whose id carries capitals, and leaves its URL alone', async () => {
    const { inListPane } = renderAt(`/browse/${LEGACY_ID}`);

    expect(await inListPane.findByText('Favourites')).toBeTruthy();
    expect(inListPane.queryByText('This list is no longer here.')).toBeNull();
    // Rewriting this to lowercase names no list at all — which is the failure the reader saw as a
    // list flashing up and vanishing on the first click.
    await new Promise((r) => setTimeout(r, 0));
    expect(globalHistory.location.pathname).toBe(`/browse/${LEGACY_ID}`);
  });

  it('still folds a capitalized corpus id and settles the URL on it', async () => {
    const { inListPane } = renderAt('/browse/DN');

    expect(await inListPane.findByText('Long Discourses')).toBeTruthy();
    await waitFor(() => expect(globalHistory.location.pathname).toBe('/browse/dn'));
  });
});
