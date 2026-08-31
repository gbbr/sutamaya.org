import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Router, navigate, globalHistory } from '@reach/router';

// Two things a deep link straight into the reader has to get right, both exercised through the
// real ReaderPage wiring rather than the helpers underneath it.
//
// Regression test for the reader landing far from the requested verse when opening a deep link
// into one specific inner sutta of a *batched* document (e.g. "dhp1", inside the batch "dhp1-20")
// that was already visited via a different inner sutta in the same session. Both share one
// scroll-memory key ("reader:dhp1-20" — see useSuttaReading.ts), so without ReaderPage turning
// its `requestedSubUid` into useScrollMemory's `skipRestore`, the *second*
// mount would restore the *first* visit's remembered scroll position before the deliberate
// jump-to-segment ever got a chance to run — see useScrollMemory.test.tsx for direct coverage of
// that mechanism in isolation; this test exercises the actual ReaderPage wiring that engages it.

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
import type { Corpus } from '../lib/types';

function buildCorpus(): Corpus {
  return {
    nikayas: [{ id: 'kn', label: 'Minor Collection', sub: 'Khuddaka Nikāya', count: 1 }],
    suttas: {
      // A batched/range document — no corpus entry for "dhp1"/"dhp14" themselves (see
      // resolveCanonicalSuttaId in lib/corpus.ts), only for the batch as a whole.
      'dhp1-20': { ref: 'Dhp 1–20', node: 'kn', en: 'Twin Verses', pali: 'Yamakavaggo', blurb: '', min: 5 },
    },
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
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
  markVisited: () => {},
};

describe('reader deep links into a batched document', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });

    const segments = [
      { key: 'dhp1:1', pali: 'Manopubbaṅgamā dhammā', en: 'Mind precedes all things' },
      { key: 'dhp14:1', pali: 'Yathāgāraṁ succhannaṁ', en: 'As a well-roofed house' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('dhp1-20.json')
          ? Promise.resolve({ ok: true, json: async () => segments })
          : Promise.reject(new Error(`unexpected fetch: ${url}`))
      )
    );

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
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

  function renderReaderAt(path: string) {
    navigate(path);
    const utils = render(
      <Router style={{ height: '100%' }}>
        <ReaderPage path="/read/:suttaId" />
      </Router>
    );
    const scrollBox = utils.container.querySelector('[data-component="ReaderPage"] .sc') as HTMLDivElement;
    return { ...utils, scrollBox };
  }

  it("doesn't restore a previous verse's remembered scroll position onto a fresh deep link within the same batch", async () => {
    // First visit: open dhp14 (mid-batch), let its text load, then simulate having scrolled deep
    // into the document before closing.
    const first = renderReaderAt('/read/dhp14');
    await screen.findByText('As a well-roofed house');
    first.scrollBox.scrollTop = 900;
    first.scrollBox.dispatchEvent(new Event('scroll'));
    first.unmount(); // persists scrollTop=900 under the shared key "reader:dhp1-20"

    // Second visit: a fresh deep link to dhp1 — a *different* verse in the *same* batch document,
    // so it shares that same scroll-memory key. Its own scrollTop must not start out at the stale
    // 900 left over from dhp14's visit.
    const second = renderReaderAt('/read/dhp1');
    await screen.findByText('Mind precedes all things');
    await waitFor(() => expect(second.scrollBox.scrollTop).not.toBe(900));
    expect(second.scrollBox.scrollTop).toBe(0);
  });

  // A link copied from a reference as the app displays it ("Dhp 14") carries capitals that no uid
  // in the corpus has. It has to open the same document — here, still resolving the inner verse to
  // its enclosing batch — and settle the address bar on the canonical lowercase path.
  it('opens a capitalized deep link, and rewrites the URL to the canonical id', async () => {
    renderReaderAt('/read/DHP14');
    await screen.findByText('As a well-roofed house');
    await waitFor(() => expect(globalHistory.location.pathname).toBe('/read/dhp14'));
  });
});
