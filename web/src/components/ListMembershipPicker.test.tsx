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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user, promptGoogleSignIn: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useUserData).mockReturnValue({
    lists: [],
    membership: {},
    toggleMembership,
    addToList,
    createList,
  } as unknown as ReturnType<typeof useUserData>);
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
    vi.mocked(useUserData).mockReturnValue({
      lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] }],
      membership: {},
      toggleMembership,
      addToList,
      createList,
    } as unknown as ReturnType<typeof useUserData>);
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
});
