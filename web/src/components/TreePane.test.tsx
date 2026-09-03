import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Characterization tests written against TreePane as it stands today, before it's split into
// TreeRow/ListRow/SignedInBadge + useListTreeIndex/useListCrud/useListTreeDrag — the goal is a
// fast, repeatable "did this extraction change behavior" signal for the parts that are cheap to
// assert this way: corpus-tree expand/select, My Lists rendering/CRUD, search, and the couple of
// pane-level keyboard shortcuts. As each piece moves to its own file, keep these tests (and add
// to them at the unit level for the extracted pieces) rather than deleting them.
//
// Deliberately NOT covered here: real pointer/touch drag-and-drop reordering and nesting. jsdom
// has no pointer-capture or layout geometry (every element's bounding rect is 0x0), so a test
// exercising `onRowPointerDown`'s movement-threshold + rect-hit-testing logic here would either
// be trivially true or need mocking so extensive it stops being a meaningful check. That's
// covered by a manual touch/drag smoke pass instead (see the refactor plan).

vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LayoutContext', () => ({ useLayout: vi.fn() }));
vi.mock('@reach/router', () => ({ navigate: vi.fn() }));
vi.mock('../lib/pwaNudge', () => ({
  isStandalone: vi.fn(),
  hasOpenedSutta: vi.fn(),
  isOfflineNudgeDismissed: vi.fn(),
  dismissOfflineNudge: vi.fn(),
  dismissedOfflineUpdateVersion: vi.fn(),
  dismissOfflineUpdate: vi.fn(),
}));
vi.mock('../lib/offline', () => ({ estimateOfflineStatus: vi.fn(), isOfflineTextStale: vi.fn() }));
vi.mock('../lib/localAccount', () => ({
  isIosBrowserTab: vi.fn(),
  isKeepSafeDismissed: vi.fn(),
  dismissKeepSafe: vi.fn(),
}));

import { navigate } from '@reach/router';
import {
  OFFLINE_DOWNLOAD_TEXT,
  OFFLINE_UPDATE_TEXT,
  REAUTH_TEXT,
  KEEP_SAFE_TEXT,
  KEEP_SAFE_IOS_TEXT,
} from './HeaderBanner';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import {
  isStandalone,
  hasOpenedSutta,
  isOfflineNudgeDismissed,
  dismissOfflineNudge,
  dismissedOfflineUpdateVersion,
  dismissOfflineUpdate,
} from '../lib/pwaNudge';
import { estimateOfflineStatus, isOfflineTextStale } from '../lib/offline';
import { dismissKeepSafe, isIosBrowserTab, isKeepSafeDismissed } from '../lib/localAccount';
import { TreePane } from './TreePane';
import { searchCorpus, searchLists, LIST_RESULTS_CAP, SEARCH_NO_MATCHES, SEARCH_PLACEHOLDER } from '../lib/corpus';
import type { Corpus, ListDef, User } from '../lib/types';

function buildCorpus(): Corpus {
  return {
    nikayas: [
      { id: 'dn', label: 'Long Discourses', sub: 'Dīgha Nikāya', count: 34 },
      {
        id: 'an',
        label: 'Numbered Discourses',
        sub: 'Aṅguttara Nikāya',
        count: 100,
        chapters: [
          {
            id: 'an1',
            ref: 'AN 1',
            label: 'Book of Ones',
            count: 50,
            chapters: [{ id: 'an1-v1', ref: 'AN 1.1–10', label: 'Vagga One', count: 10 }],
          },
        ],
      },
    ],
    suttas: {
      'an1.1-10': {
        ref: 'AN 1.1–10',
        node: 'an1-v1',
        en: 'Overcoming the Hindrances',
        pali: 'Nīvaraṇapahānavaggo',
        blurb: 'On overcoming the five hindrances',
        min: 4,
      },
    },
    // dataVersion is what the offline-staleness banner tests below compare against; the other two
    // are filler no test here reads.
    dataVersion: 'data-v1',
    sujatoCommit: 'abc1234',
    dictionaryVersion: 'dict-v1',
  };
}

function buildLists(): ListDef[] {
  return [
    { id: 'g1', label: 'Suttas to study', parentId: null, kind: 'group', items: [] },
    { id: 'l1', label: 'Favorites', parentId: 'g1', kind: 'list', items: ['an1.1-10'] },
    { id: 'l2', label: 'Read later', parentId: null, kind: 'list', items: [] },
  ];
}

function buildUser(): User {
  return { id: 'u1', email: 'reader@example.com', name: 'Reader', picture: null };
}

function mockUserData(overrides: Partial<ReturnType<typeof useUserData>> = {}): ReturnType<typeof useUserData> {
  return {
    ready: true,
    lists: buildLists(),
    membership: {},
    notes: {},
    highlights: {},
    visited: {},
    syncStatus: 'synced',
    pendingCount: 0,
    lastSyncedAt: null,
    needsReauth: false,
    listMembers: () => [],
    createList: vi.fn(async () => buildLists()[0]),
    renameList: vi.fn(async () => {}),
    removeList: vi.fn(async () => {}),
    reorderLists: vi.fn(async () => {}),
    reorderListItems: vi.fn(async () => {}),
    toggleMembership: vi.fn(async () => {}),
    addToList: vi.fn(async () => {}),
    submitNote: vi.fn(async () => {}),
    setHighlightSpan: vi.fn(async () => {}),
    markVisited: vi.fn(),
    ...overrides,
  };
}

function mockLayout(overrides: Partial<ReturnType<typeof useLayout>> = {}): ReturnType<typeof useLayout> {
  return {
    treeW: 264,
    w: 1200,
    mobile: false,
    paneW: { tree: 264, treeMax: 600 },
    resetTree: vi.fn(),
    dragTree: vi.fn(),
    ...overrides,
  };
}

// Mirrors how LibraryPage actually drives TreePane: nodeId/query are controlled from outside,
// updated via the onSelect/onSearch callbacks TreePane calls, and `hits` is computed from `query`
// the same way LibraryPage computes it (once, outside TreePane) and hands it down — a Harness
// makes typing/clicking in the rendered tree behave the same way it does in the real app instead
// of needing a manual rerender() after every interaction.
function Harness({
  initialNodeId,
  onSelect,
  onOpenSutta,
  shortcutsOpen,
}: {
  initialNodeId?: string;
  onSelect: (id: string) => void;
  onOpenSutta: (id: string) => void;
  shortcutsOpen?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [nodeId, setNodeId] = useState(initialNodeId);
  const [listsExpanded, setListsExpanded] = useState(false);
  const { corpus } = useCorpus();
  const { notes, lists } = useUserData();
  const hits = useMemo(() => (corpus && query.trim() ? searchCorpus(corpus, query, notes, lists) : []), [corpus, query, notes, lists]);
  // Mirrors LibraryPage, which owns the expansion and hands both panes the trimmed block.
  const listHits = useMemo(() => searchLists(lists, query), [lists, query]);
  const shownListHits = listsExpanded ? listHits : listHits.slice(0, LIST_RESULTS_CAP);
  return (
    <TreePane
      nodeId={nodeId}
      onSelect={(id) => {
        setNodeId(id);
        onSelect(id);
      }}
      onOpenSutta={onOpenSutta}
      onSearch={setQuery}
      query={query}
      hits={hits}
      listHits={shownListHits}
      listHitTotal={listHits.length}
      // Nothing here fetches the search text, so this pane draws the metadata-only empty state.
      textStatus="idle"
      listsExpanded={listsExpanded}
      onToggleListsExpanded={() => setListsExpanded((v) => !v)}
      shortcutsOpen={shortcutsOpen}
    />
  );
}

function renderHarness(initialNodeId?: string, shortcutsOpen?: boolean) {
  const onSelect = vi.fn();
  const onOpenSutta = vi.fn();
  const utils = render(
    <Harness initialNodeId={initialNodeId} onSelect={onSelect} onOpenSutta={onOpenSutta} shortcutsOpen={shortcutsOpen} />
  );
  return { ...utils, onSelect, onOpenSutta };
}

let userData: ReturnType<typeof useUserData>;

beforeEach(() => {
  // Tree-expansion state (and paneView) persist to localStorage across mounts (see TreePane's
  // loadPersistedExpansion) — Node's own built-in `localStorage` global shadows jsdom's here in a
  // way that leaves it `undefined` rather than a working store (see the same workaround in
  // pages/mobileSearchReaderFlow.test.tsx), so stub a plain in-memory one, fresh per test.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), loading: false, error: false, retry: vi.fn() });
  userData = mockUserData();
  vi.mocked(useUserData).mockImplementation(() => userData);
  vi.mocked(useAuth).mockReturnValue({
    user: buildUser(),
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
  vi.mocked(useLayout).mockReturnValue(mockLayout());
  // Default to "neither nudge can show" for every test that isn't specifically about them — see
  // the 'offline download nudge' / 'offline text update nudge' blocks for the cases overriding
  // these.
  vi.mocked(isStandalone).mockReturnValue(false);
  vi.mocked(hasOpenedSutta).mockReturnValue(false);
  vi.mocked(isOfflineNudgeDismissed).mockReturnValue(false);
  // Cleared, not just re-stubbed: several tests below assert this *wasn't* called (the cheap
  // synchronous checks are meant to rule a banner out before the cache probe ever runs), which
  // only means anything against a fresh call count.
  vi.mocked(estimateOfflineStatus).mockClear();
  vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 0, total: 0 });
  vi.mocked(dismissedOfflineUpdateVersion).mockReturnValue(null);
  vi.mocked(isOfflineTextStale).mockReturnValue(false);
  // Same idea for the deferred-sign-in banner: signed in by default (see the useAuth stub above),
  // so it can't show unless a test signs the user out.
  vi.mocked(isIosBrowserTab).mockReturnValue(false);
  vi.mocked(isKeepSafeDismissed).mockReturnValue(false);
});

describe('corpus browse tree', () => {
  it('renders nikaya rows at the top level', () => {
    renderHarness();
    expect(screen.getByText('Long Discourses')).toBeInTheDocument();
    expect(screen.getByText('Numbered Discourses')).toBeInTheDocument();
  });

  it('selects a non-expandable nikaya directly', async () => {
    const { onSelect } = renderHarness();
    await userEvent.click(screen.getByText('Long Discourses'));
    expect(onSelect).toHaveBeenCalledWith('dn');
  });

  it('expands nested chapters and selects a leaf', async () => {
    const { onSelect } = renderHarness();
    expect(screen.queryByText('Book of Ones')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Numbered Discourses'));
    expect(screen.getByText('Book of Ones')).toBeInTheDocument();
    expect(screen.queryByText('Vagga One')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Book of Ones'));
    expect(screen.getByText('Vagga One')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Vagga One'));
    expect(onSelect).toHaveBeenCalledWith('an1-v1');
  });
});

function switchToMyLists() {
  return userEvent.click(screen.getByRole('button', { name: 'Lists' }));
}

// The armed delete row, whose two lines the helpers below read separately.
function deleteConfirmBox() {
  return screen.getByRole('button', { name: 'Cancel' }).closest('[data-component="DeleteConfirm"]') as HTMLElement;
}

// The second line, naming what the delete takes with it. Absent entirely when the row holds
// nothing, which is what keeps an empty list confirming on a single line.
function deleteScopeText() {
  const lines = deleteConfirmBox().children;
  return lines.length > 1 ? (lines[1].querySelector('span')?.textContent ?? '') : null;
}

// The first line, the prompt itself, reassembled. It's split across spans so only the list's own
// label truncates (see ListRow), which puts it out of reach of a plain getByText — that matches
// on an element's *direct* text children. The nbsp holding "Delete" to the opening quote is
// normalized back to a plain space so the expectations below read normally.
function deletePromptText() {
  return (deleteConfirmBox().querySelector('span')?.textContent ?? '').replace(/ /g, ' ');
}

describe('My Lists tree', () => {
  it('renders top-level groups/lists with item counts, nested content revealed on expand', async () => {
    renderHarness();
    await switchToMyLists();
    expect(screen.getByText('Suttas to study')).toBeInTheDocument();
    expect(screen.getByText('Read later')).toBeInTheDocument();
    expect(screen.queryByText('Favorites')).not.toBeInTheDocument();

    const groupRow = screen.getByText('Suttas to study').closest('[data-node-id]') as HTMLElement;
    expect(within(groupRow).getByText('1')).toBeInTheDocument(); // groupTotalLists: 1 list nested inside

    await userEvent.click(screen.getByText('Suttas to study'));
    expect(screen.getByText('Favorites')).toBeInTheDocument();
    const listRow = screen.getByText('Favorites').closest('[data-node-id]') as HTMLElement;
    expect(within(listRow).getByText('1')).toBeInTheDocument(); // listTotalMembers: 1 distinct sutta
  });

  it('opens and closes the list-options menu', async () => {
    renderHarness();
    await switchToMyLists();
    const row = screen.getByText('Read later').closest('[data-node-id]') as HTMLElement;
    const optionsBtn = within(row).getByLabelText('List options');
    expect(screen.queryByLabelText('Rename')).not.toBeInTheDocument();
    await userEvent.click(optionsBtn);
    expect(screen.getByLabelText('Rename')).toBeInTheDocument();
    await userEvent.click(optionsBtn);
    expect(screen.queryByLabelText('Rename')).not.toBeInTheDocument();
  });

  it('commits a rename on Enter', async () => {
    renderHarness();
    await switchToMyLists();
    await userEvent.dblClick(screen.getByText('Read later'));
    const input = screen.getByDisplayValue('Read later');
    await userEvent.clear(input);
    await userEvent.type(input, 'To read later{Enter}');
    expect(userData.renameList).toHaveBeenCalledWith('l2', 'To read later');
  });

  it('cancels a rename on Escape without committing', async () => {
    renderHarness();
    await switchToMyLists();
    await userEvent.dblClick(screen.getByText('Read later'));
    const input = screen.getByDisplayValue('Read later');
    await userEvent.type(input, ' edited{Escape}');
    expect(userData.renameList).not.toHaveBeenCalled();
    expect(screen.getByText('Read later')).toBeInTheDocument();
  });

  it('deletes a list after arm-then-confirm', async () => {
    renderHarness();
    await switchToMyLists();
    const row = screen.getByText('Read later').closest('[data-node-id]') as HTMLElement;
    await userEvent.click(within(row).getByLabelText('List options'));
    await userEvent.click(screen.getByLabelText('Delete'));
    expect(deletePromptText()).toBe('Delete "Read later"?');
    // Empty, so the prompt stays a single line — nothing to warn about.
    expect(deleteScopeText()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(userData.removeList).toHaveBeenCalledWith('l2');
  });

  it('cancelling arm-delete leaves the list untouched', async () => {
    renderHarness();
    await switchToMyLists();
    const row = screen.getByText('Read later').closest('[data-node-id]') as HTMLElement;
    await userEvent.click(within(row).getByLabelText('List options'));
    await userEvent.click(screen.getByLabelText('Delete'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(userData.removeList).not.toHaveBeenCalled();
    expect(screen.getByText('Read later')).toBeInTheDocument();
  });

  it('deletes a non-empty list rather than blocking on its contents', async () => {
    renderHarness();
    await switchToMyLists();
    await userEvent.click(screen.getByText('Suttas to study')); // expand the group to reach Favorites
    const row = screen.getByText('Favorites').closest('[data-node-id]') as HTMLElement;
    await userEvent.click(within(row).getByLabelText('List options'));
    await userEvent.click(screen.getByLabelText('Delete'));
    expect(deletePromptText()).toBe('Delete "Favorites"?');
    expect(deleteScopeText()).toBe('1 sutta');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(userData.removeList).toHaveBeenCalledWith('l1');
  });

  it('deletes a group with lists nested inside it rather than blocking on them', async () => {
    renderHarness();
    await switchToMyLists();
    const row = screen.getByText('Suttas to study').closest('[data-node-id]') as HTMLElement;
    await userEvent.click(within(row).getByLabelText('List options'));
    await userEvent.click(screen.getByLabelText('Delete'));
    expect(deletePromptText()).toBe('Delete "Suttas to study"?');
    // The group's own row shows only the nested-list count, so the prompt is the one place the
    // suttas going with it are named.
    expect(deleteScopeText()).toBe('1 list · 1 sutta');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(userData.removeList).toHaveBeenCalledWith('g1');
  });

  it('deleting the list being shown navigates nowhere, leaving the pane to explain itself', async () => {
    // However a list goes away — deleted here, deleted on another device, a link that outlived it
    // — the reader gets the same pane saying so (see ListPane's empty state). Moving them
    // somewhere else on the one route that could would make this device the odd one out.
    vi.mocked(navigate).mockClear();
    renderHarness('l2');
    await switchToMyLists();
    const row = screen.getByText('Read later').closest('[data-node-id]') as HTMLElement;
    await userEvent.click(within(row).getByLabelText('List options'));
    await userEvent.click(screen.getByLabelText('Delete'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(userData.removeList).toHaveBeenCalledWith('l2');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the top-level "+" opens a List/Group picker defaulting to List, with the input autofocused', async () => {
    renderHarness();
    await switchToMyLists();
    await userEvent.click(screen.getByLabelText('New list or group'));
    const input = screen.getByPlaceholderText('List name — return to create');
    expect(input).toHaveFocus();
    expect(screen.getByLabelText('Switch to Group')).toBeInTheDocument();

    await userEvent.type(input, 'New List{Enter}');
    expect(userData.createList).toHaveBeenCalledWith('New List', null, 'list');
  });

  it('the picker is a single toggle: clicking it flips List/Group regardless of which side is "active"', async () => {
    renderHarness();
    await switchToMyLists();
    await userEvent.click(screen.getByLabelText('New list or group'));
    const input = screen.getByPlaceholderText('List name — return to create');

    // First click (currently on List) flips to Group.
    await userEvent.click(screen.getByLabelText('Switch to Group'));
    // The picker click must not blur (and thereby cancel) the draft input — onBlur closes it.
    expect(screen.getByPlaceholderText('Group name — return to create')).toBe(input);
    expect(input).toHaveFocus();

    // Clicking the *same* toggle again (now labeled for the opposite direction) flips back to
    // List — proving the whole control toggles on any click, not just a specific side's button.
    await userEvent.click(screen.getByLabelText('Switch to List'));
    expect(screen.getByPlaceholderText('List name — return to create')).toBe(input);

    await userEvent.click(screen.getByLabelText('Switch to Group'));
    await userEvent.type(input, 'New Group{Enter}');
    expect(userData.createList).toHaveBeenCalledWith('New Group', null, 'group');
  });

  it('opens a newly created list, since a list is a page', async () => {
    userData = mockUserData({
      createList: vi.fn(async (label: string) => ({ id: 'new-1', label, parentId: null, kind: 'list' as const, items: [] })),
    });
    vi.mocked(navigate).mockClear();
    renderHarness();
    await switchToMyLists();
    await userEvent.click(screen.getByLabelText('New list or group'));
    await userEvent.type(screen.getByPlaceholderText('List name — return to create'), 'New List{Enter}');

    expect(navigate).toHaveBeenCalledWith('/browse/new-1');
  });

  it('leaves the list pane alone when the new row is a group', async () => {
    // A group holds lists, not suttas: its row expands in place and never opens a page, so there
    // is nothing for the pane to show. Navigating to it anyway replaced whatever was being read
    // with an untitled empty page that no click could get back to — and left that URL as the
    // app's remembered last location.
    userData = mockUserData({
      createList: vi.fn(async (label: string) => ({ id: 'new-g', label, parentId: null, kind: 'group' as const, items: [] })),
    });
    vi.mocked(navigate).mockClear();
    renderHarness();
    await switchToMyLists();
    await userEvent.click(screen.getByLabelText('New list or group'));
    await userEvent.click(screen.getByLabelText('Switch to Group'));
    await userEvent.type(screen.getByPlaceholderText('Group name — return to create'), 'New Group{Enter}');

    expect(userData.createList).toHaveBeenCalledWith('New Group', null, 'group');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  // On desktop, ListPane sits right next to this pane and renders the same hits with more detail
  // — TreePane no longer duplicates the row list there, only on mobile (where ListPane isn't
  // shown at all). These tests exercise the "does the row list actually work" behavior, which
  // needs the mobile case; the desktop (count-only) case has its own test below.
  beforeEach(() => {
    vi.mocked(useLayout).mockReturnValue(mockLayout({ mobile: true }));
  });

  it('is hidden until the search icon is clicked, then autofocuses', async () => {
    renderHarness();
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Search'));
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toHaveFocus();
  });

  it('filters to matching results and opens one on click, leaving the search UI as-is', async () => {
    const { onOpenSutta } = renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    await userEvent.type(input, 'hindrance');
    // A result's title is split around the matched words (see MatchedText), so it is no longer
    // one text node — match on the element's own text instead of a bare string.
    const hitTitle = () => screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Overcoming the Hindrances');
    expect(hitTitle()).toBeInTheDocument();
    await userEvent.click(hitTitle());
    // No segment: this hit matched a title, and only a text hit has one to open at.
    expect(onOpenSutta).toHaveBeenCalledWith('an1.1-10', undefined);
    // Deliberately *not* cleared here — clearing it synchronously would flash the bare tree for
    // a frame before the (deferred) navigation actually replaces this page with the reader. It's
    // left for the real component to unmount along with the rest of this page once that happens.
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toHaveValue('hindrance');
  });

  it('shows a no-matches state for a query with no hits', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    await userEvent.type(input, 'nonexistentquery');
    expect(screen.getByText(SEARCH_NO_MATCHES)).toBeInTheDocument();
  });

  it('typing without opening search first reaches nothing (no hidden input to type into)', async () => {
    renderHarness();
    await userEvent.keyboard('hindrance');
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByText('Overcoming the Hindrances')).not.toBeInTheDocument();
  });

  it('"/" opens and focuses the search box from anywhere; Escape closes and clears it', async () => {
    renderHarness();
    fireEvent.keyDown(window, { key: '/' });
    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER) as HTMLInputElement;
    expect(input).toHaveFocus();
    await userEvent.type(input, 'hindrance');
    expect(screen.queryByText(SEARCH_NO_MATCHES)).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('the inline "x" clears and closes the search box', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    await userEvent.type(input, 'hindrance');
    await userEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('submitting an empty query (Enter) closes the search box', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('clicking the search icon again while open closes it (same as "x"/Escape)', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Close search'));
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('on desktop, shows only the result count — not the row list (ListPane renders results there)', async () => {
    vi.mocked(useLayout).mockReturnValue(mockLayout({ mobile: false }));
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    await userEvent.type(input, 'hindrance');
    expect(screen.getByText('1 result')).toBeInTheDocument();
    expect(screen.queryByText('Overcoming the Hindrances')).not.toBeInTheDocument();
  });
});

describe('tree expansion persistence', () => {
  it('an expansion made by hand survives a fresh mount, on top of whatever the new mount itself force-expands', async () => {
    const { unmount } = renderHarness();
    await userEvent.click(screen.getByText('Numbered Discourses'));
    expect(screen.getByText('Book of Ones')).toBeInTheDocument();
    unmount();

    // Fresh mount (simulating a remount/refresh), no nodeId this time — nothing left to
    // force-expand via the current node's own ancestors alone, so this only passes if the
    // earlier manual expansion was actually persisted and re-applied.
    renderHarness();
    expect(screen.getByText('Book of Ones')).toBeInTheDocument();
  });

  it('a deep-linked node still force-expands its own ancestors regardless of what was persisted', () => {
    renderHarness('an1-v1');
    expect(screen.getByText('Book of Ones')).toBeInTheDocument();
    expect(screen.getByText('Vagga One')).toBeInTheDocument();
  });

  it('a collapse survives remounting onto the same node — leaving for Settings and coming back', async () => {
    const { unmount } = renderHarness('an1-v1');
    expect(screen.getByText('Vagga One')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Numbered Discourses')); // collapse the revealed chain
    expect(screen.queryByText('Vagga One')).not.toBeInTheDocument();
    unmount();

    // Same node as the one persisted: a return to the pane, not a navigation to it, so the
    // ancestors of `an1-v1` must stay closed rather than being force-revealed again.
    renderHarness('an1-v1');
    expect(screen.queryByText('Vagga One')).not.toBeInTheDocument();
    expect(screen.queryByText('Book of Ones')).not.toBeInTheDocument();
  });
});

describe('keyboard: x toggles Library / My Lists', () => {
  it('switches views when signed in', () => {
    renderHarness();
    expect(screen.getByText('Long Discourses')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.queryByText('Long Discourses')).not.toBeInTheDocument();
    expect(screen.getByText('Suttas to study')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.getByText('Long Discourses')).toBeInTheDocument();
  });

  it('My Lists survives a remount onto the same node — leaving for Settings and coming back', () => {
    const { unmount } = renderHarness('an1-v1');
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.getByText('Suttas to study')).toBeInTheDocument();
    unmount();

    // Flipping the toggle doesn't change nodeId, so this mount still arrives pointed at a
    // corpus node. It's a return, not a navigation, and must not snap the pane to Library.
    renderHarness('an1-v1');
    expect(screen.getByText('Suttas to study')).toBeInTheDocument();
    expect(screen.queryByText('Long Discourses')).not.toBeInTheDocument();
  });
});

describe('keyboard: the shortcuts modal owns every key while open', () => {
  it('"/" does not open the search box behind it', () => {
    renderHarness(undefined, true);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('"x" does not swap Library / My Lists behind it', () => {
    renderHarness(undefined, true);
    expect(screen.getByText('Long Discourses')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.getByText('Long Discourses')).toBeInTheDocument();
  });
});

describe('offline download nudge', () => {
  const nudgeText = OFFLINE_DOWNLOAD_TEXT;

  it('stays hidden in a regular (non-PWA) browser tab even once a sutta has been opened and the corpus is incomplete', async () => {
    vi.mocked(isStandalone).mockReturnValue(false);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 3, total: 10 });
    renderHarness();
    // Nothing async to actually wait on here (the cheap synchronous checks already rule the
    // banner out before estimateOfflineStatus would ever be called) — this just confirms it
    // never appears.
    expect(screen.queryByText(nudgeText)).not.toBeInTheDocument();
    expect(estimateOfflineStatus).not.toHaveBeenCalled();
  });

  it('stays hidden until a sutta has actually been opened, even when standalone', () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(false);
    renderHarness();
    expect(screen.queryByText(nudgeText)).not.toBeInTheDocument();
    expect(estimateOfflineStatus).not.toHaveBeenCalled();
  });

  it('stays hidden once already dismissed', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(isOfflineNudgeDismissed).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 3, total: 10 });
    renderHarness();
    // The cache probe still runs — dismissing this banner mustn't also silence the "updated text
    // available" one that shares the slot, and that one needs to know whether the corpus is fully
    // cached. Only the banner itself is suppressed.
    await vi.waitFor(() => expect(estimateOfflineStatus).toHaveBeenCalled());
    expect(screen.queryByText(nudgeText)).not.toBeInTheDocument();
  });

  it('stays hidden once the corpus is already fully cached for offline', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 10, total: 10 });
    renderHarness();
    await vi.waitFor(() => expect(estimateOfflineStatus).toHaveBeenCalled());
    expect(screen.queryByText(nudgeText)).not.toBeInTheDocument();
  });

  it('shows once standalone, a sutta has been opened, and the corpus is incomplete', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 3, total: 10 });
    renderHarness();
    expect(await screen.findByText(nudgeText)).toBeInTheDocument();
  });

  it('its Download button navigates to Settings scrolled to the offline section', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 3, total: 10 });
    renderHarness();
    await screen.findByText(nudgeText);
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(navigate).toHaveBeenCalledWith('/settings', { state: { scrollTo: 'offline' } });
  });

  it('dismissing hides it and persists the dismissal', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 3, total: 10 });
    renderHarness();
    await screen.findByText(nudgeText);
    await userEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText(nudgeText)).not.toBeInTheDocument();
    expect(dismissOfflineNudge).toHaveBeenCalled();
  });
});

describe('offline text update nudge', () => {
  const updateText = OFFLINE_UPDATE_TEXT;
  const downloadText = OFFLINE_DOWNLOAD_TEXT;

  // The state this banner is actually for: a device that finished a bulk download, whose cached
  // text has since fallen behind the corpus this build serves. Deliberately leaves isStandalone
  // at its `false` default — unlike the download nudge, this one is not PWA-gated.
  function stale() {
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 10, total: 10 });
    vi.mocked(isOfflineTextStale).mockReturnValue(true);
  }

  it('shows once the fully-cached corpus has fallen behind the build', async () => {
    stale();
    renderHarness();
    expect(await screen.findByText(updateText)).toBeInTheDocument();
  });

  // Standalone here only so the cache probe still runs — this has to show the banner staying away
  // because the copy is current, not because nothing was ever checked.
  it('stays hidden while the cached text still matches the build', async () => {
    stale();
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(isOfflineTextStale).mockReturnValue(false);
    renderHarness();
    await vi.waitFor(() => expect(estimateOfflineStatus).toHaveBeenCalled());
    expect(screen.queryByText(updateText)).not.toBeInTheDocument();
  });

  // The two banners share one slot, so "not fully cached yet" has to win — telling someone their
  // copy is out of date is meaningless when they haven't got a complete one.
  it('defers to the download nudge while the corpus is still incomplete', async () => {
    stale();
    vi.mocked(isStandalone).mockReturnValue(true); // the download nudge it defers to is PWA-only
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 3, total: 10 });
    renderHarness();
    expect(await screen.findByText(downloadText)).toBeInTheDocument();
    expect(screen.queryByText(updateText)).not.toBeInTheDocument();
  });

  // Unlike the download nudge, this one is not PWA-gated: CacheFirst serves the same stale text in
  // a tab as in an installed app, and it only ever fires for someone who already chose to download
  // the whole canon.
  it('shows in a regular browser tab too', async () => {
    stale();
    vi.mocked(isStandalone).mockReturnValue(false);
    vi.mocked(hasOpenedSutta).mockReturnValue(false);
    renderHarness();
    expect(await screen.findByText(updateText)).toBeInTheDocument();
  });

  // ...but the cache probe behind it still stays off the common path, since nothing is stale for
  // anyone who never bulk-downloaded.
  it('never probes Cache Storage for a device that has no bulk download recorded', () => {
    vi.mocked(isOfflineTextStale).mockReturnValue(false);
    renderHarness();
    expect(screen.queryByText(updateText)).not.toBeInTheDocument();
    expect(estimateOfflineStatus).not.toHaveBeenCalled();
  });

  it('its Update button navigates to Settings scrolled to the offline section', async () => {
    stale();
    renderHarness();
    await screen.findByText(updateText);
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(navigate).toHaveBeenCalledWith('/settings', { state: { scrollTo: 'offline' } });
  });

  // Dismissal records the version rather than a boolean, so the next corpus change nudges again.
  it('dismissing hides it and persists the dismissal against this dataVersion', async () => {
    stale();
    renderHarness();
    await screen.findByText(updateText);
    await userEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText(updateText)).not.toBeInTheDocument();
    expect(dismissOfflineUpdate).toHaveBeenCalledWith('data-v1');
  });

  it('stays hidden once dismissed at this dataVersion, and returns at the next one', async () => {
    stale();
    vi.mocked(dismissedOfflineUpdateVersion).mockReturnValue('data-v1');
    const { unmount } = renderHarness();
    await vi.waitFor(() => expect(estimateOfflineStatus).toHaveBeenCalled());
    expect(screen.queryByText(updateText)).not.toBeInTheDocument();
    unmount();

    vi.mocked(dismissedOfflineUpdateVersion).mockReturnValue('data-v0');
    renderHarness();
    expect(await screen.findByText(updateText)).toBeInTheDocument();
  });
});

describe('sync state', () => {
  // Only a lapsed session gets chrome here. The rest resolve on their own — draining, or offline —
  // and are spelled out in Settings instead.
  it.each(['pending', 'offline'] as const)('shows nothing for %s', (syncStatus) => {
    userData = mockUserData({ syncStatus, pendingCount: 2 });
    vi.mocked(useUserData).mockImplementation(() => userData);
    renderHarness();
    expect(screen.queryByText(REAUTH_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('surfaces a lapsed session and calls promptGoogleSignIn on click, without navigating on its own', async () => {
    const promptGoogleSignIn = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      user: buildUser(),
      isSignedIn: true,
      dataUserId: 'u1',
      localUserId: 'local-test',
      loading: false,
      authError: null,
      requestEmailCode: vi.fn(async () => {}),
      signInWithEmailCode: vi.fn(async () => {}),
      promptGoogleSignIn,
      logout: vi.fn(async () => {}),
    });
    userData = mockUserData({ needsReauth: true });
    vi.mocked(useUserData).mockImplementation(() => userData);
    renderHarness();

    expect(screen.getByText(REAUTH_TEXT)).toBeInTheDocument();
    // Only the user's own click calls it — nothing on the auth or sync side does so on its own
    // (see UserDataContext.tsx's flush(), which sets `needsReauth` rather than navigating away).
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(promptGoogleSignIn).toHaveBeenCalled();
  });

  it('takes the banner slot from an offline nudge that would otherwise show', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 0, total: 10 });
    userData = mockUserData({ needsReauth: true });
    vi.mocked(useUserData).mockImplementation(() => userData);
    renderHarness();

    expect(await screen.findByText(REAUTH_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE_DOWNLOAD_TEXT)).not.toBeInTheDocument();
  });
});

describe('deferred sign-in', () => {
  const keepSafeText = KEEP_SAFE_TEXT;
  const iosText = KEEP_SAFE_IOS_TEXT;

  function signedOut(userDataOverrides: Partial<ReturnType<typeof useUserData>> = {}) {
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
    userData = mockUserData({ lists: [], ...userDataOverrides });
    vi.mocked(useUserData).mockImplementation(() => userData);
  }

  it('offers My Lists to a signed-out reader', () => {
    signedOut({ lists: buildLists() });
    renderHarness();
    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.getByText('Suttas to study')).toBeInTheDocument();
  });

  it('stays quiet until the reader has made something worth keeping', () => {
    signedOut();
    renderHarness();
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
  });

  it('does not count merely reading as something worth keeping', () => {
    signedOut({ visited: { dn1: '2026-01-01T00:00:00.000Z' } });
    renderHarness();
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
  });

  it('shows after a first note', () => {
    signedOut({ notes: { dn1: 'a thought' } });
    renderHarness();
    expect(screen.getByText(keepSafeText)).toBeInTheDocument();
  });

  it('shows after a first list, but not for the auto-lists', () => {
    signedOut({ lists: [{ id: 'auto-recent', label: 'Visited', parentId: null, kind: 'list', items: [], auto: true }] });
    const { unmount } = renderHarness();
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
    unmount();

    signedOut({ lists: buildLists() });
    renderHarness();
    expect(screen.getByText(keepSafeText)).toBeInTheDocument();
  });

  it('waits for a second highlight, counting a cross-segment one as one', () => {
    const crossSegment = [{ id: 'g1', i0: 0, o0: 0, i1: 1, o1: 5, c: '#ff0', m: '1|d' }];
    signedOut({ highlights: { dn1: crossSegment } });
    const { unmount } = renderHarness();
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
    unmount();

    signedOut({
      highlights: {
        dn1: crossSegment,
        dn2: [{ id: 'g2', i0: 0, o0: 0, i1: 0, o1: 5, c: '#ff0', m: '2|d' }],
      },
    });
    renderHarness();
    expect(screen.getByText(keepSafeText)).toBeInTheDocument();
  });

  it('escalates to the red tone on iOS in a browser tab, same text otherwise', () => {
    vi.mocked(isIosBrowserTab).mockReturnValue(true);
    signedOut({ notes: { dn1: 'a thought' } });
    renderHarness();
    const banner = screen.getByText(iosText).closest('[data-component="HeaderBanner"]');
    expect(banner).toHaveClass('bg-danger-text/[.09]');
  });

  it('dismissing hides it and records the local id it was dismissed for', async () => {
    signedOut({ notes: { dn1: 'a thought' } });
    renderHarness();
    await userEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
    expect(dismissKeepSafe).toHaveBeenCalledWith('local-test');
  });

  it('stays hidden once already dismissed for this local id', () => {
    vi.mocked(isKeepSafeDismissed).mockReturnValue(true);
    signedOut({ notes: { dn1: 'a thought' } });
    renderHarness();
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
  });

  it('takes the banner slot from an offline nudge, and yields it to re-auth', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 0, total: 10 });
    signedOut({ notes: { dn1: 'a thought' } });
    const { unmount } = renderHarness();
    expect(screen.getByText(keepSafeText)).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE_DOWNLOAD_TEXT)).not.toBeInTheDocument();
    unmount();

    signedOut({ notes: { dn1: 'a thought' }, needsReauth: true });
    renderHarness();
    expect(await screen.findByText(REAUTH_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
  });

  it('leaves the slot empty on dismiss rather than swapping in the download nudge, which returns on the next mount', async () => {
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(hasOpenedSutta).mockReturnValue(true);
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 0, total: 10 });
    signedOut({ notes: { dn1: 'a thought' } });
    const { unmount } = renderHarness();

    await userEvent.click(screen.getByLabelText('Dismiss'));
    // Let the cache probe settle before asserting the slot is empty, so this fails for the right
    // reason: without it the download banner could be missing merely because `offlineCachedStatus`
    // hadn't resolved yet, and the assertion would hold even with the swap back in place.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(keepSafeText)).not.toBeInTheDocument();
    expect(screen.queryByText(OFFLINE_DOWNLOAD_TEXT)).not.toBeInTheDocument();
    unmount();

    // Returning from the reader remounts TreePane, which is when the next banner down gets its turn.
    vi.mocked(isKeepSafeDismissed).mockReturnValue(true);
    signedOut({ notes: { dn1: 'a thought' } });
    renderHarness();
    expect(await screen.findByText(OFFLINE_DOWNLOAD_TEXT)).toBeInTheDocument();
  });
});
