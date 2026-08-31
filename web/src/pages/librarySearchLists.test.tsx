import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Router, navigate } from '@reach/router';

// Covers the one thing this feature changes about search results that already worked: when a
// query matches exactly one list, the suttas that got there *only* through that list's name stop
// being listed, because the list's own row now stands for them. The rule lives in LibraryPage,
// which is why this is a rendered test rather than a unit one — searchCorpus still returns those
// hits, and searchLists knows nothing about them.

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
import { SEARCH_PLACEHOLDER } from '../lib/corpus';
import type { Corpus, ListDef } from '../lib/types';

// dn1's own blurb carries the word the lists below are named after; mn1's text has nothing to do
// with it, so it can only ever arrive via a list.
const corpus: Corpus = {
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
  dictionaryVersion: 'dict-v1',
};

const list = (over: Partial<ListDef>): ListDef => ({
  id: 'x', label: 'x', parentId: null, kind: 'list', items: [], ...over,
});

const userDataDefaults = {
  ready: true,
  lists: [] as ListDef[],
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
} as unknown as ReturnType<typeof useUserData>;

// Everything is read out of TreePane: on mobile it draws the lists block and the sutta hits
// itself, and ListPane stays mounted (hidden) with the same rows, so unscoped queries would match
// both.
function searchFor(query: string, lists: ListDef[]) {
  vi.mocked(useUserData).mockReturnValue({ ...userDataDefaults, lists });
  navigate('/browse/dn');
  const { container } = render(
    <Router style={{ height: '100%' }}>
      <LibraryPage path="/browse/:nodeId/*suttaId" />
    </Router>
  );
  const tree = within(container.querySelector('[data-component="TreePane"]')!);
  fireEvent.click(tree.getByRole('button', { name: 'Search' }));
  fireEvent.change(tree.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: query } });
  return tree;
}

describe('a library search that matches the user\'s lists', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
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
      mobile: true,
      w: 400,
      treeW: 264,
      paneW: { tree: 264, treeMax: 400 },
      resetTree: vi.fn(),
      dragTree: vi.fn(),
    });
  });

  it('shows the matching list and drops the members it is the only reason for', async () => {
    const tree = searchFor('divine', [list({ id: 'l1', label: 'Divine', items: ['mn1'] })]);

    expect(await tree.findByText('Divine')).toBeTruthy();
    // dn1 says "Divine" in its own blurb, so it stands on its own merits and stays.
    expect(tree.getByText('Brahmajala')).toBeTruthy();
    // mn1 is only here because it sits in a list called "Divine" — which is the row above.
    expect(tree.queryByText('Mulapariyaya')).toBeNull();
  });

  it('puts the search input away when a list is opened from the results', async () => {
    const tree = searchFor('divine', [list({ id: 'l1', label: 'Divine', items: ['mn1'] })]);

    fireEvent.click(await tree.findByText('Divine'));

    // The list is the destination the search was for, so the input goes with the results rather
    // than staying open over the list that just opened.
    expect(tree.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();
  });

  it('keeps every member when the query matches more than one list', async () => {
    const tree = searchFor('divine', [
      list({ id: 'l1', label: 'Divine mornings', items: ['mn1'] }),
      list({ id: 'l2', label: 'Divine evenings', items: [] }),
    ]);

    // Queried by role, not by text: the matched word is wrapped in its own <mark>, so the row's
    // label is split across elements and only its accessible name reads as one string.
    expect(await tree.findByRole('button', { name: /Divine mornings/ })).toBeTruthy();
    // Two list rows means the results are the one place their members appear together, so
    // nothing is dropped — visiting each list in turn shouldn't be the only way to see them.
    expect(tree.getByText('Mulapariyaya')).toBeTruthy();
  });
});
