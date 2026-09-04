import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Router, navigate } from '@reach/router';

// The wash on the segment a search hit was found in: on while the reader arrives, off a moment
// later. It is an orientation cue, not an annotation — a segment that stayed washed would read as
// one of the reader's own highlights.

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
import { tagIntent } from '../lib/routeIntent';
import type { Corpus } from '../lib/types';

const corpus: Corpus = {
  nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
  suttas: {
    dn1: { ref: 'DN 1', node: 'dn', en: 'The Prime Net', pali: 'Brahmajāla', blurb: '', min: 5 },
  },
  sujatoCommit: 'abc1234',
  dataVersion: 'data-v1',
  dictionaryVersion: 'dict-v1',
};

const segments = [
  { key: 'dn1:1.1', pali: 'Evaṁ me sutaṁ', en: 'So I have heard' },
  { key: 'dn1:1.2', pali: 'Atha kho', en: 'A wanderer was walking' },
  { key: 'dn1:1.3', pali: 'Tena kho pana', en: 'They spoke in dispraise of the Buddha' },
];

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
  markVisited: () => {},
};

// The wrapper div a segment's lines sit in, which carries the wash.
function segmentWrapper(container: HTMLElement, i: number): HTMLElement {
  return container.querySelector(`[data-seg="${i}"]`)!.parentElement as HTMLElement;
}

describe('the segment a search hit was found in', () => {
  beforeEach(() => {
    // Real time still runs, so the render's own awaits resolve; the flash's timer is what this
    // test advances by hand.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const store = new Map<string, string>();
    for (const name of ['localStorage', 'sessionStorage']) {
      vi.stubGlobal(name, {
        getItem: (k: string) => store.get(`${name}:${k}`) ?? null,
        setItem: (k: string, v: string) => void store.set(`${name}:${k}`, String(v)),
        removeItem: (k: string) => void store.delete(`${name}:${k}`),
        clear: () => store.clear(),
      });
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('dn1.json')
          ? Promise.resolve({ ok: true, json: async () => segments })
          : Promise.reject(new Error(`unexpected fetch: ${url}`))
      )
    );
    vi.mocked(useCorpus).mockReturnValue({ corpus, loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(userDataDefaults);
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
    vi.useRealTimers();
  });

  it('is washed on arrival, and only until the flash ends', async () => {
    navigate('/read/dn1', { state: tagIntent({ from: '/browse/dn/dn1?q=dispraise', fromView: 'list', segment: 2 }) });
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    await screen.findByText('They spoke in dispraise of the Buddha');

    await waitFor(() => expect(segmentWrapper(container, 2).style.background).not.toBe(''));
    // The rest of the passage is untouched, so the wash says which segment answered the search.
    expect(segmentWrapper(container, 0).style.background).toBe('');

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(segmentWrapper(container, 2).style.background).toBe('');
  });

  it('is not washed when the reader was not sent to a segment', async () => {
    navigate('/read/dn1', { state: { from: '/browse/dn/dn1', fromView: 'list' } });
    const { container } = render(
      <Router style={{ height: '100%' }}>
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    await screen.findByText('They spoke in dispraise of the Buddha');

    for (const i of [0, 1, 2]) expect(segmentWrapper(container, i).style.background).toBe('');
  });
});
