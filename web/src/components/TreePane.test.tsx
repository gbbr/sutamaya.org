import { useState } from 'react';
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

import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { TreePane } from './TreePane';
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
    listMembers: () => [],
    createList: vi.fn(async () => buildLists()[0]),
    renameList: vi.fn(async () => {}),
    removeList: vi.fn(async () => {}),
    setListParent: vi.fn(async () => {}),
    reorderLists: vi.fn(async () => {}),
    reorderListItems: vi.fn(async () => {}),
    toggleMembership: vi.fn(async () => {}),
    addToList: vi.fn(async () => {}),
    submitNote: vi.fn(async () => {}),
    setHighlightRange: vi.fn(async () => {}),
    removeHighlights: vi.fn(async () => {}),
    markVisited: vi.fn(),
    syncUserData: vi.fn(async () => {}),
    ...overrides,
  };
}

function mockLayout(overrides: Partial<ReturnType<typeof useLayout>> = {}): ReturnType<typeof useLayout> {
  return {
    treeW: 264,
    listW: 404,
    previewHidden: false,
    w: 1200,
    mobile: false,
    twoPane: false,
    desktop: true,
    paneW: { tree: 264, list: 404, treeMax: 600, listMax: 600 },
    hidePreview: vi.fn(),
    showPreview: vi.fn(),
    resetTree: vi.fn(),
    resetList: vi.fn(),
    dragTree: vi.fn(),
    dragList: vi.fn(),
    ...overrides,
  };
}

// Mirrors how LibraryPage actually drives TreePane: nodeId/query are controlled from outside,
// updated via the onSelect/onSearch callbacks TreePane calls — a Harness makes typing/clicking
// in the rendered tree behave the same way it does in the real app instead of needing a manual
// rerender() after every interaction.
function Harness({
  initialNodeId,
  onSelect,
  onOpenSutta,
}: {
  initialNodeId?: string;
  onSelect: (id: string) => void;
  onOpenSutta: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [nodeId, setNodeId] = useState(initialNodeId);
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
    />
  );
}

function renderHarness(initialNodeId?: string) {
  const onSelect = vi.fn();
  const onOpenSutta = vi.fn();
  const utils = render(<Harness initialNodeId={initialNodeId} onSelect={onSelect} onOpenSutta={onOpenSutta} />);
  return { ...utils, onSelect, onOpenSutta };
}

let userData: ReturnType<typeof useUserData>;

beforeEach(() => {
  vi.mocked(useCorpus).mockReturnValue({ corpus: buildCorpus(), dictionary: null, loading: false });
  userData = mockUserData();
  vi.mocked(useUserData).mockImplementation(() => userData);
  vi.mocked(useAuth).mockReturnValue({
    user: buildUser(),
    loading: false,
    googleReady: true,
    loginWithGoogle: vi.fn(async () => {}),
    promptGoogleSignIn: vi.fn(),
    logout: vi.fn(async () => {}),
  });
  vi.mocked(useLayout).mockReturnValue(mockLayout());
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
  return userEvent.click(screen.getByLabelText('Switch to My Lists'));
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
    expect(screen.getByText('Delete "Read later"?')).toBeInTheDocument();
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

  it('blocks deleting a non-empty list, showing a message instead of the confirm row', async () => {
    renderHarness();
    await switchToMyLists();
    await userEvent.click(screen.getByText('Suttas to study')); // expand the group to reach Favorites
    const row = screen.getByText('Favorites').closest('[data-node-id]') as HTMLElement;
    await userEvent.click(within(row).getByLabelText('List options'));
    await userEvent.click(screen.getByLabelText('Delete'));
    expect(screen.getByText('"Favorites" has 1 sutta — remove them first.')).toBeInTheDocument();
    expect(screen.queryByText('Delete "Favorites"?')).not.toBeInTheDocument();
    expect(userData.removeList).not.toHaveBeenCalled();
    // Auto-dismiss timing itself is covered at the hook level (useListCrud.test.tsx) — combining
    // fake timers with user-event's own internal delays here isn't worth the added flakiness risk.
  });

  it('blocks deleting a non-empty group, showing a message instead of the confirm row', async () => {
    renderHarness();
    await switchToMyLists();
    const row = screen.getByText('Suttas to study').closest('[data-node-id]') as HTMLElement;
    await userEvent.click(within(row).getByLabelText('List options'));
    await userEvent.click(screen.getByLabelText('Delete'));
    expect(screen.getByText('"Suttas to study" has 1 list — move them out first.')).toBeInTheDocument();
    expect(userData.removeList).not.toHaveBeenCalled();
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
});

describe('search', () => {
  it('is hidden until the search icon is clicked, then autofocuses', async () => {
    renderHarness();
    expect(screen.queryByPlaceholderText('Search ID, title, blurb, note, text')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Search'));
    expect(screen.getByPlaceholderText('Search ID, title, blurb, note, text')).toHaveFocus();
  });

  it('filters to matching results and opens one on click, closing search afterward', async () => {
    const { onOpenSutta } = renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText('Search ID, title, blurb, note, text');
    await userEvent.type(input, 'hindrance');
    expect(screen.getByText('Overcoming the Hindrances')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Overcoming the Hindrances'));
    expect(onOpenSutta).toHaveBeenCalledWith('an1.1-10');
    expect(screen.queryByPlaceholderText('Search ID, title, blurb, note, text')).not.toBeInTheDocument();
  });

  it('shows a no-matches state for a query with no hits', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText('Search ID, title, blurb, note, text');
    await userEvent.type(input, 'nonexistentquery');
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('typing without opening search first reaches nothing (no hidden input to type into)', async () => {
    renderHarness();
    await userEvent.keyboard('hindrance');
    expect(screen.queryByPlaceholderText('Search ID, title, blurb, note, text')).not.toBeInTheDocument();
    expect(screen.queryByText('Overcoming the Hindrances')).not.toBeInTheDocument();
  });

  it('"/" opens and focuses the search box from anywhere; Escape closes and clears it', async () => {
    renderHarness();
    fireEvent.keyDown(window, { key: '/' });
    const input = screen.getByPlaceholderText('Search ID, title, blurb, note, text') as HTMLInputElement;
    expect(input).toHaveFocus();
    await userEvent.type(input, 'hindrance');
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Search ID, title, blurb, note, text')).not.toBeInTheDocument();
  });

  it('the inline "x" clears and closes the search box', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText('Search ID, title, blurb, note, text');
    await userEvent.type(input, 'hindrance');
    await userEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.queryByPlaceholderText('Search ID, title, blurb, note, text')).not.toBeInTheDocument();
  });

  it('submitting an empty query (Enter) closes the search box', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    const input = screen.getByPlaceholderText('Search ID, title, blurb, note, text');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByPlaceholderText('Search ID, title, blurb, note, text')).not.toBeInTheDocument();
  });

  it('clicking the search icon again while open closes it (same as "x"/Escape)', async () => {
    renderHarness();
    await userEvent.click(screen.getByLabelText('Search'));
    expect(screen.getByPlaceholderText('Search ID, title, blurb, note, text')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Close search'));
    expect(screen.queryByPlaceholderText('Search ID, title, blurb, note, text')).not.toBeInTheDocument();
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
});
