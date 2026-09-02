import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Router, navigate } from '@reach/router';

// Covers the Reader sutta header's list-membership chips + highlight-count badge — consolidated
// onto the same <SuttaRowChips> component ListPane/TreePane/ReaderSearchOverlay use (see that
// component's own test for its rendering/theming contract). This file exercises the two bits of
// behavior specific to the Reader's usage: a chip click navigates to that list, and the badge
// click opens the Highlights panel tab — both wired via SuttaRowChips' onChipClick/
// onHighlightClick props rather than SuttaRowChips' own default (non-interactive) behavior.

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('../context/ReaderPrefsContext', () => ({ useReaderPrefs: vi.fn() }));
// LibraryPage (rendered by the chip-navigation test) reads it only for the Shift+D theme toggle.
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: () => ({ toggleTheme: vi.fn() }) }));

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { LibraryPage } from './LibraryPage';
import { ReaderPage } from './ReaderPage';
import type { Corpus, Highlight } from '../lib/types';

function buildCorpus(): Corpus {
  return {
    nikayas: [{ id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 1 }],
    suttas: {
      dn1: { ref: 'DN 1', node: 'dn', en: 'Brahmajala', pali: 'Brahmajālasutta', blurb: 'The Divine Net', min: 5 },
    },
    sujatoCommit: 'abc1234',
    dataVersion: 'data-v1',
    dictionaryVersion: 'dict-v1',
  };
}

const highlight: Highlight = { id: 'h1', i0: 0, o0: 0, i1: 0, o1: 5, c: '#F0E3A8', m: '2026-01-01T00:00:00.000Z|dev' };

const userDataDefaults: ReturnType<typeof useUserData> = {
  ready: true,
  lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: ['dn1'] }],
  membership: { dn1: ['l1'] },
  notes: {},
  highlights: { dn1: [highlight] },
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

describe('ReaderPage sutta header chips', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    // Never resolves — this suite only cares about the header (title/chips/badge), which renders
    // off corpus/membership/highlights directly, not the fetched segment text (see
    // mobileSearchReaderFlow.test.tsx, which uses the same stub for the same reason).
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
    vi.mocked(useUserData).mockReturnValue(userDataDefaults);
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'reader@example.com', name: 'Reader', picture: null },
      isSignedIn: true,
      dataUserId: 'u1',
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

  function renderReader() {
    navigate('/read/dn1');
    return render(
      <Router style={{ height: '100%' }}>
        <ReaderPage path="/read/:suttaId" />
        <LibraryPage path="/browse/:nodeId/*suttaId" />
      </Router>
    );
  }

  it('shows a chip for each list the sutta belongs to and a badge with its highlight count', async () => {
    renderReader();
    await screen.findByText('Brahmajala');
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy(); // one highlight group -> badge count
  });

  it('clicking a chip navigates to that list, with dn1 selected', async () => {
    const { container } = renderReader();
    await screen.findByText('Brahmajala');
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));

    // Reader unmounts (path no longer matches /read/:suttaId) and ListPane shows the list it
    // navigated to, with dn1 as its item — dn1's own row there shows a "Favorites" chip too
    // (still a member of that list), alongside the pane's own "Favorites" header title, so this
    // checks for at least one match rather than a single unique one.
    await waitFor(() => expect(screen.queryByText('Brahmajala', { selector: 'h1' })).toBeNull());
    const listPane = () => within(container.querySelector('[data-component="ListPane"]')!);
    await waitFor(() => expect(listPane().getAllByText('Favorites').length).toBeGreaterThan(0));
    expect(listPane().getByText('Brahmajala')).toBeTruthy();
  });

  it('clicking the highlight badge opens the Highlights panel tab', async () => {
    renderReader();
    await screen.findByText('Brahmajala');
    fireEvent.click(screen.getByText('1'));

    // "Sutta note" only renders under the Highlights tab for a signed-in user (ReaderMenuPanel);
    // the one seeded highlight (no fetched segment text, since fetch never resolves) renders as
    // "Segment 1", its own no-text fallback.
    expect(await screen.findByText('Sutta note')).toBeTruthy();
    expect(screen.getByText('Segment 1')).toBeTruthy();
  });
});
