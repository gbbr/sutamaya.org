import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { ListMembershipPicker } from './ListMembershipPicker';
import { READER_THEMES } from '../lib/theme';

const theme = READER_THEMES.light;
const user = { id: 'u1', email: 'a@b.com', name: 'A', picture: '' };

// Resolves only when the test says so, standing in for a create that's still in flight — which is
// the whole window this guard exists to cover.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const createList = vi.fn();
const addToList = vi.fn();
const toggleMembership = vi.fn();

// `ready` is part of what the picker reads: the pinned section is snapshotted from membership the
// first time the mirror reports itself loaded, so a mock without it never pins anything.
function mockUserData(state: { lists: unknown[]; membership: Record<string, string[]> }) {
  vi.mocked(useUserData).mockReturnValue({
    ready: true,
    toggleMembership,
    addToList,
    createList,
    ...state,
  } as unknown as ReturnType<typeof useUserData>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user, promptGoogleSignIn: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  mockUserData({ lists: [], membership: {} });
});

describe('ListMembershipPicker', () => {
  it('creates a list only once when the create row is activated twice before the POST returns', async () => {
    const pending = deferred<{ id: string; label: string; parentId: null; kind: 'list'; items: string[] }>();
    createList.mockReturnValue(pending.promise);
    const typist = userEvent.setup();

    render(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    const input = screen.getByRole('textbox');
    await typist.type(input, 'Readings');

    // Two activations while the first create is still out — a double-tap, or an Enter held a beat
    // too long on a slow connection.
    await typist.keyboard('{Enter}');
    await typist.keyboard('{Enter}');

    // createList() dedupes against `lists`, which cannot yet contain a list whose create hasn't
    // resolved — without the in-flight guard the second activation creates a duplicate.
    expect(createList).toHaveBeenCalledTimes(1);
    expect(createList).toHaveBeenCalledWith('Readings', null, 'list');

    pending.resolve({ id: 'l1', label: 'Readings', parentId: null, kind: 'list', items: [] });
  });

  it('allows a second create once the first has settled', async () => {
    createList.mockResolvedValue({ id: 'l1', label: 'Readings', parentId: null, kind: 'list', items: [] });
    const typist = userEvent.setup();

    render(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    const input = screen.getByRole('textbox');

    await typist.type(input, 'Readings');
    await typist.keyboard('{Enter}');
    await typist.type(input, 'Later');
    await typist.keyboard('{Enter}');

    // The guard must release — it suppresses a concurrent duplicate, not every subsequent create.
    expect(createList).toHaveBeenCalledTimes(2);
    expect(createList).toHaveBeenLastCalledWith('Later', null, 'list');
  });

  it('does not swallow a repeated membership toggle, which is a legitimate on-then-off', async () => {
    mockUserData({ lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] }], membership: {} });
    const typist = userEvent.setup();

    render(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    const input = screen.getByRole('textbox');
    await typist.type(input, 'Favorites');

    await typist.keyboard('{Enter}');
    await typist.keyboard('{Enter}');

    // Add/remove item are idempotent server-side (routes/lists.js), so this path is deliberately
    // left unguarded.
    expect(toggleMembership).toHaveBeenCalledTimes(2);
  });

  // Group rows are part of the keyboard walk in browse mode, because activating one collapses or
  // expands its subtree.
  it('collapses and expands a group from the keyboard while browsing', async () => {
    mockUserData({
      lists: [
        { id: 'g1', label: 'Study', parentId: null, kind: 'group', items: [] },
        { id: 'l1', label: 'Satipatthana', parentId: 'g1', kind: 'list', items: [] },
        { id: 'l2', label: 'Favorites', parentId: null, kind: 'list', items: [] },
      ],
      membership: {},
    });
    const typist = userEvent.setup();

    render(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    const input = screen.getByRole('textbox');
    input.focus();

    // Rows are [Study (group), Satipatthana, Favorites], everything expanded on open.
    await typist.keyboard('{ArrowDown}{Enter}');
    expect(toggleMembership).toHaveBeenLastCalledWith('dn1', 'l1');

    await typist.keyboard('{ArrowDown}{Enter}');
    expect(toggleMembership).toHaveBeenLastCalledWith('dn1', 'l2');

    // Back onto the group. Enter there collapses it, taking its nested list off screen without
    // touching membership; Enter again brings it back.
    await typist.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    expect(screen.queryByText('Satipatthana')).toBeNull();
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(toggleMembership).toHaveBeenCalledTimes(2);

    await typist.keyboard('{Enter}');
    expect(screen.getByText('Satipatthana')).toBeTruthy();
  });

  // Search mode drops groups entirely and appends the create row, so Enter on the last row
  // creates rather than toggling.
  it('navigates search results and lands on the create row past the last match', async () => {
    createList.mockResolvedValue({ id: 'l9', label: 'Sati', parentId: null, kind: 'list', items: [] });
    mockUserData({
      lists: [
        { id: 'g1', label: 'Study', parentId: null, kind: 'group', items: [] },
        { id: 'l1', label: 'Satipatthana', parentId: 'g1', kind: 'list', items: [] },
      ],
      membership: {},
    });
    const typist = userEvent.setup();

    render(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    await typist.type(screen.getByRole('textbox'), 'Sati');

    // Rows are [Satipatthana, Create list "Sati"] — the group matched nothing of its own and is
    // not a row here at all.
    await typist.keyboard('{ArrowDown}{Enter}');
    expect(createList).toHaveBeenCalledWith('Sati', null, 'list');
    expect(toggleMembership).not.toHaveBeenCalled();
  });

  // The lists a sutta is already in are repeated flat at the top of browse mode, so a checked list
  // buried in a deep group is never below the fold.
  it('pins the lists the sutta is already in above the tree, with their parent path', () => {
    mockUserData({
      lists: [
        { id: 'g1', label: 'Study', parentId: null, kind: 'group', items: [] },
        { id: 'g2', label: 'Dependent origination', parentId: 'g1', kind: 'group', items: [] },
        { id: 'l1', label: 'Core texts', parentId: 'g2', kind: 'list', items: ['dn1'] },
        { id: 'l2', label: 'Favorites', parentId: null, kind: 'list', items: ['dn1'] },
        { id: 'l3', label: 'To re-read', parentId: null, kind: 'list', items: [] },
      ],
      membership: { dn1: ['l1', 'l2'] },
    });

    render(<ListMembershipPicker suttaId="dn1" theme={theme} />);

    // Pinned rows come first, in tree order, each naming its ancestors — then the tree itself, in
    // plain depth-first order with nothing floated.
    const rows = screen.getAllByRole('button').map((b) => b.textContent);
    expect(rows[0]).toContain('Core texts');
    expect(rows[0]).toContain('Study / Dependent origination');
    expect(rows[1]).toContain('Favorites');
    expect(rows.slice(2)).toEqual(['Study', 'Dependent origination', 'Core texts', 'Favorites', 'To re-read']);
  });

  it('keeps a pinned row in place after it is unchecked', () => {
    const lists = [
      { id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: ['dn1'] },
      { id: 'l2', label: 'To re-read', parentId: null, kind: 'list', items: [] },
    ];
    mockUserData({ lists, membership: { dn1: ['l1'] } });

    const { rerender } = render(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    expect(screen.getAllByText('Favorites')).toHaveLength(2);

    // Unchecking it. The section is filled from membership as it stood when the picker opened, so
    // the row stays put (unchecked) rather than vanishing from under the pointer — otherwise a
    // mistaken tap would leave nothing to tap again.
    mockUserData({ lists, membership: {} });
    rerender(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    expect(screen.getAllByText('Favorites')).toHaveLength(2);
  });

  it('shows no pinned section when the sutta is in no list', () => {
    mockUserData({
      lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] }],
      membership: {},
    });

    render(<ListMembershipPicker suttaId="dn1" theme={theme} />);
    expect(screen.getAllByText('Favorites')).toHaveLength(1);
  });
});
