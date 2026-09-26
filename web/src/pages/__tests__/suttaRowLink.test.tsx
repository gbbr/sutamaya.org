import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { renderRoutes } from '../../testRouter';

// A sutta row is a link to its reader page, so the browser's own ways of opening one elsewhere —
// a ⌘- or Ctrl-click, a middle click, "Open Link in New Tab" — work on it, while a plain click
// opens it here with the app's own transition.

vi.mock('../../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));
vi.mock('../../lib/platform', async (original) => ({
  ...(await original<typeof import('../../lib/platform')>()),
  isNativeApp: vi.fn(() => false),
}));

import { useCorpus } from '../../context/CorpusContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { useLayout } from '../../context/LayoutContext';
import { isNativeApp } from '../../lib/platform';
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

function renderList() {
  const utils = renderRoutes(
    [
      { path: '/browse/:nodeId/*', element: <LibraryPage key="node" /> },
      { path: '/browse', element: <LibraryPage key="none" /> },
    ],
    '/browse/fav'
  );
  const pane = within(utils.container.querySelector('[data-component="ListPane"]') as HTMLElement);
  return { ...utils, row: () => pane.findByRole('link', { name: /DN 1\s*Brahmajala/ }) };
}

describe('a sutta row', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    vi.mocked(isNativeApp).mockReturnValue(false);

    vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue({
      ready: true,
      lists: [favourites],
      membership: { dn1: ['fav'] },
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

  it('links to the sutta’s reader page', async () => {
    const { row } = renderList();
    expect((await row()).getAttribute('href')).toBe('/read/dn1');
  });

  it('opens here on a plain click', async () => {
    const { row, router } = renderList();
    fireEvent.click(await row());
    expect(router.state.location.pathname).toBe('/read/dn1');
  });

  it('leaves a ⌘- or Ctrl-click to the browser', async () => {
    const { row, router } = renderList();
    fireEvent.click(await row(), { metaKey: true });
    fireEvent.click(await row(), { ctrlKey: true });
    expect(router.state.location.pathname).toBe('/browse/fav');
  });

  it('opens here on a ⌘-click in the native apps, which have no tabs', async () => {
    vi.mocked(isNativeApp).mockReturnValue(true);
    const { row, router } = renderList();
    fireEvent.click(await row(), { metaKey: true });
    expect(router.state.location.pathname).toBe('/read/dn1');
  });
});
