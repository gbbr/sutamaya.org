import { describe, expect, it, vi, beforeEach } from 'vitest';
import { within } from '@testing-library/react';
import { renderRoutes } from '../../testRouter';
import { NOTES_AUTO_LIST_ID } from '../../lib/lists/autoLists';

// A sutta row shows the reader's note in the Notes list, in place of the description. In any other
// list it keeps the description and marks the note beside its chips.

vi.mock('../../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));

import { useCorpus } from '../../context/CorpusContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { useLayout } from '../../context/LayoutContext';
import { LibraryPage } from '../LibraryPage';
import type { Corpus, ListDef } from '../../lib/types';

const corpus: Corpus = {
  nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
  suttas: {
    dn1: { ref: 'DN 1', node: 'dn', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
  },
  sujatoCommit: 'abc1234',
  dataVersion: 'data-v1',
  searchVersion: 'search-v1',
  dictionaryVersion: 'dict-v1',
};

const favourites: ListDef = { id: 'fav', label: 'Favourites', parentId: null, kind: 'list', items: ['dn1'] };
const notesList: ListDef = { id: NOTES_AUTO_LIST_ID, label: 'Keywords', parentId: null, kind: 'list', items: ['dn1'], auto: true };

// rowIn renders the list `listId` and returns dn1's row in it.
async function rowIn(listId: string) {
  const { container } = renderRoutes(
    [
      { path: '/browse/:nodeId/*', element: <LibraryPage key="node" /> },
      { path: '/browse', element: <LibraryPage key="none" /> },
    ],
    `/browse/${listId}`
  );
  const pane = within(container.querySelector('[data-component="ListPane"]') as HTMLElement);
  return within(await pane.findByRole('link', { name: /DN 1\s*Brahmajala/ }));
}

describe('a sutta row with a note', () => {
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
    vi.mocked(useUserData).mockReturnValue({
      ready: true,
      lists: [favourites, notesList],
      membership: { dn1: ['fav', NOTES_AUTO_LIST_ID] },
      notes: { dn1: 'Read this slowly' },
      highlights: {},
      visited: {},
      syncStatus: 'synced' as const,
      pendingCount: 0,
      lastSyncedAt: null,
      needsReauth: false,
      listMembers: () => [],
      markVisited: () => {},
    } as unknown as ReturnType<typeof useUserData>);
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isSignedIn: false,
      dataUserId: 'local-test',
      localUserId: 'local-test',
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useLayout).mockReturnValue({
      mobile: false,
      w: 1200,
      treeW: 264,
      paneW: { tree: 264, treeMax: 600 },
      resetTree: vi.fn(),
      dragTree: vi.fn(),
    });
  });

  it('keeps its description in a list, and marks the note', async () => {
    const row = await rowIn('fav');
    expect(row.getByText('The Divine Net')).toBeTruthy();
    expect(row.queryByText('Read this slowly')).toBeNull();
    expect(row.getByRole('img', { name: 'Has keywords' })).toBeTruthy();
  });

  it('shows the note in the Notes list, in place of the description and the mark', async () => {
    const row = await rowIn(NOTES_AUTO_LIST_ID);
    expect(row.getByText('Read this slowly')).toBeTruthy();
    expect(row.queryByText('The Divine Net')).toBeNull();
    expect(row.queryByRole('img', { name: 'Has keywords' })).toBeNull();
  });
});
