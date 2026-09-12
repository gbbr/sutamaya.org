import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderRoutes } from '../testRouter';

// Where a sutta that has a tab opens, which is the whole of what a tab is for: the line it
// remembers, whatever the reader used to get there — here a Library row rather than the bar. A
// return is the exception, and its price: it hands back the place this device left, so a reading
// cold-opened on a device that has never held a place for it starts at the top, tab or no tab.

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
import { forgetScrollPosition } from '../hooks/useScrollMemory';
import { SEGMENT_START_MARGIN } from '../lib/segmentScroll';
import { ReaderPage } from './ReaderPage';
import type { Corpus } from '../lib/types';

// jsdom lays nothing out, so the reader's measurements are stubbed: the pane sits at the top of the
// screen and each segment SEG_H below the one before it, which is all scrollToSegment needs.
const SEG_H = 40;
// Where the second segment's own line lands the pane, and so where the tab below resumes.
const SECOND_SEGMENT_TOP = 2 * SEG_H - SEGMENT_START_MARGIN;
// An offset left by this device's own reading, deeper in than either segment.
const OWN_PLACE = 900;

const segments = [
  { key: 'mn1:1.1', pali: 'Evaṁ me sutaṁ', en: 'So I have heard' },
  { key: 'mn1:2.1', pali: 'Atha kho', en: 'Then the Buddha said' },
];

function buildCorpus(): Corpus {
  return {
    nikayas: [{ id: 'mn', label: 'Middle Discourses', sub: 'Majjhima Nikāya', count: 1 }],
    suttas: {
      mn1: { ref: 'MN 1', node: 'mn', en: 'The Root of All Things', pali: 'Mūlapariyāyasutta', blurb: '', min: 5 },
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
  // The tab under test: mn1, left on its second segment.
  putAside: [{ suttaId: 'mn1', key: 'mn1:2.1', pct: 50 }],
  putSuttaAside: () => {},
  trackPutAside: () => {},
  dropPutAside: () => {},
  clearPutAside: () => {},
};

describe('a sutta that has a tab', () => {
  const realRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    forgetScrollPosition('reader:mn1');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('mn1.json')
          ? Promise.resolve({ ok: true, json: async () => segments })
          : Promise.reject(new Error(`unexpected fetch: ${url}`))
      )
    );
    // A segment's wrapper reads as the segment it holds; everything else, the scrolling pane
    // included, reads as the top of the screen.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const seg = this.matches('[data-seg]') ? this : this.querySelector(':scope > [data-seg]');
      if (!(seg instanceof HTMLElement)) return new DOMRect(0, 0, 600, 800);
      return new DOMRect(0, (Number(seg.dataset.seg) + 1) * SEG_H, 600, SEG_H);
    };

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(userDataDefaults);
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

  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
  });

  function renderReader() {
    const utils = renderRoutes(
      [
        { path: '/', element: <div>Library</div> },
        { path: '/read/:suttaId', element: <ReaderPage /> },
      ],
      '/read/mn1'
    );
    return { ...utils, pane: () => utils.container.querySelector('[data-component="ReaderPage"] .sc') as HTMLDivElement };
  }

  // The reading arrives, is scrolled somewhere of its own, and is left for the Library — so this
  // device remembers a place in it, as it would after any real reading.
  async function readAndLeave(utils: ReturnType<typeof renderReader>) {
    await screen.findByText('So I have heard');
    const pane = utils.pane();
    pane.scrollTop = OWN_PLACE;
    pane.dispatchEvent(new Event('scroll'));
    await act(async () => {
      await utils.router.navigate('/');
    });
  }

  // The frames a resume takes to land, so a reading asserted to have stayed put has had the same
  // room to move as one asserted to have moved.
  async function settle() {
    await act(async () => {
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));
    });
  }

  it('opens at its tab line when a Library row is what opened it', async () => {
    const utils = renderReader();
    await readAndLeave(utils);

    await act(async () => {
      await utils.router.navigate('/read/mn1');
    });
    await screen.findByText('So I have heard');
    await waitFor(() => expect(utils.pane().scrollTop).toBe(SECOND_SEGMENT_TOP));
  });

  it('comes back to this device’s own place, not the tab line, on a return', async () => {
    const utils = renderReader();
    await readAndLeave(utils);

    await act(async () => {
      await utils.router.navigate(-1);
    });
    await screen.findByText('So I have heard');
    await settle();
    expect(utils.pane().scrollTop).toBe(OWN_PLACE);
  });

  // The price of keeping the rule to one question: a return is a return on a cold load too, so a
  // link opened on a device that holds no place of its own for the reading starts at the top.
  it('opens a cold link at the top, this device holding no place in the reading', async () => {
    const utils = renderReader();
    await screen.findByText('So I have heard');
    await settle();
    expect(utils.pane().scrollTop).toBe(0);
  });
});
