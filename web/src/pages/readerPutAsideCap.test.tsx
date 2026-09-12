import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderRoutes } from '../testRouter';

// The one rule the put-aside cap has to keep: a full set drops nothing of the reader's to make
// room. The minimise control opens the sheet instead, and what leaves is whatever they close there.

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
import { ReaderPage } from './ReaderPage';
import { PUT_ASIDE_CAP, type PutAsideEntry } from '../lib/putAside';
import type { Corpus, SuttaMap } from '../lib/types';

const parked: PutAsideEntry[] = Array.from({ length: PUT_ASIDE_CAP }, (_, i) => ({
  suttaId: `mn${i + 1}`,
  key: `mn${i + 1}:1.1`,
  pct: 10 * (i + 1),
}));

function buildCorpus(): Corpus {
  const suttas: SuttaMap = {
    dn1: { ref: 'DN 1', node: 'dn', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: '', min: 5 },
  };
  for (const entry of parked) {
    const n = entry.suttaId.slice(2);
    suttas[entry.suttaId] = { ref: `MN ${n}`, node: 'mn', en: `Discourse ${n}`, pali: '', blurb: '', min: 5 };
  }
  return {
    nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
    suttas,
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
    searchVersion: 'search-v1',
    dictionaryVersion: 'dict-v1',
  };
}

describe('the reader at the put-aside cap', () => {
  const putSuttaAside = vi.fn();
  const dropPutAside = vi.fn();

  beforeEach(() => {
    putSuttaAside.mockClear();
    dropPutAside.mockClear();

    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    // Never resolves: this suite reads the header and the bar, neither of which waits on the text.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
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
      putAside: parked,
      putSuttaAside,
      trackPutAside: () => {},
      dropPutAside,
      clearPutAside: () => {},
    });
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isSignedIn: false,
      dataUserId: 'local-test',
      localUserId: 'local-test',
      loading: false,
      signingIn: false,
      authError: null,
      requestEmailCode: vi.fn(async () => {}),
      signInWithEmailCode: vi.fn(async () => {}),
      promptGoogleSignIn: vi.fn(),
      signInWithGoogleNative: vi.fn(async () => {}),
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

  function renderReader() {
    return renderRoutes([{ path: '/read/:suttaId', element: <ReaderPage /> }], '/read/dn1');
  }

  async function openTheFullSheet() {
    renderReader();
    fireEvent.click(await screen.findByLabelText('Set aside'));
  }

  it('asks which tab should go rather than setting the sutta aside over one of them', async () => {
    await openTheFullSheet();
    expect(
      await screen.findByText(
        `You can set aside ${PUT_ASIDE_CAP} suttas at a time. Remove one or more to make room.`
      )
    ).toBeTruthy();
    expect(putSuttaAside).not.toHaveBeenCalled();
  });

  it('drops only the tab the reader closes there', async () => {
    await openTheFullSheet();
    fireEvent.click(await screen.findByLabelText('Dismiss MN 3'));
    expect(dropPutAside).toHaveBeenCalledTimes(1);
    expect(dropPutAside).toHaveBeenCalledWith('mn3');
  });

  // A sutta holding a tab of its own is not competing for a slot, so a full set has nothing to ask
  // it. Its header stands down Close for the way back into that tab, that being the whole of how
  // such a reading is left.
  it('sends a reading that already has a tab back to it, full set or not', async () => {
    renderRoutes([{ path: '/read/:suttaId', element: <ReaderPage /> }], '/read/mn1');
    expect(await screen.findByLabelText('Back to the bar')).toBeTruthy();
    expect(screen.queryByTitle('Close')).toBeNull();

    fireEvent.click(screen.getByLabelText('Back to the bar'));
    expect(
      screen.queryByText(
        `You can set aside ${PUT_ASIDE_CAP} suttas at a time. Remove one or more to make room.`
      )
    ).toBeNull();
  });
});
