// The seam between AuthContext and UserDataContext, exercised with both real providers.
//
// UserDataContext.test.tsx stubs `useAuth`, so it proves the mirror does the right thing *given*
// an identity — not that the identity itself is wired up. That wiring is the whole of deferred
// sign-in: which id a signed-out reader writes under, that signing in hands the provider the
// account while still naming the local mirror to adopt, and that signing out retires the account's
// copy without stranding anything. Only `authApi` and the sync endpoints are mocked here.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import { UserDataProvider, useUserData } from './UserDataContext';
import { LOCAL_USER_KEY } from '../lib/storageKeys';
import type { User } from '../lib/types';
import type { PushItem, UserData } from '../lib/api';

const authMe = vi.fn();
const authLogout = vi.fn();
const dataApiAll = vi.fn();
const dataApiPush = vi.fn();

vi.mock('../lib/api', () => ({
  authApi: {
    me: () => authMe(),
    logout: () => authLogout(),
    requestEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
  },
  dataApi: { all: () => dataApiAll(), push: (...args: unknown[]) => dataApiPush(...args) },
}));

vi.mock('@reach/router', () => ({ navigate: vi.fn() }));

const ACCOUNT: User = { id: 'account-1', email: 'a@b.com', name: 'A', picture: null };

const emptyData: UserData = { lists: [], membership: {}, notes: {}, highlights: {}, visited: {} };

// The fake server keeps what was pushed to it, because the flush pulls a full snapshot straight
// after pushing and `applySnapshot` keeps only what is still dirty (lib/mirror.ts). A snapshot that
// forgot the note it had just accepted would blank it one render after adoption produced it —
// making an assertion on the note a race against a single frame rather than a check of the result.
let serverNotes: UserData['notes'] = {};

// A minimal surface over both providers: the note is the cheapest record to assert, and the two
// buttons are the two identity transitions under test.
function Probe() {
  const { user, dataUserId, localUserId } = useAuth();
  const { ready, notes, submitNote, pendingCount } = useUserData();
  const { logout } = useAuth();
  return (
    <div>
      <div data-testid="who">{user ? `signed-in:${user.id}` : 'signed-out'}</div>
      <div data-testid="dataUserId">{dataUserId}</div>
      <div data-testid="localUserId">{localUserId}</div>
      <div data-testid="ready">{String(ready)}</div>
      <div data-testid="note">{notes.dn1 ?? ''}</div>
      <div data-testid="pending">{pendingCount}</div>
      <button onClick={() => submitNote('dn1', 'made before signing in')}>write note</button>
      <button onClick={() => logout()}>sign out</button>
    </div>
  );
}

function mount() {
  return render(
    <AuthProvider>
      <UserDataProvider>
        <Probe />
      </UserDataProvider>
    </AuthProvider>
  );
}

// IndexedDB writes settle on their own turn, so a "reload" has to let the save land first.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  authMe.mockResolvedValue({ user: null });
  authLogout.mockResolvedValue({ ok: true });
  serverNotes = {};
  dataApiAll.mockImplementation(async () => ({ ...structuredClone(emptyData), notes: { ...serverNotes } }));
  dataApiPush.mockImplementation(async (items: PushItem[]) => ({
    results: items.map((item) => {
      if (item.type === 'note') serverNotes[item.suttaId] = { text: item.text, m: item.mtime };
      return { ok: true as const };
    }),
  }));
});

// Every note the flush has pushed, across however many requests it took.
function pushedNotes() {
  return dataApiPush.mock.calls
    .flatMap((call) => call[0] as PushItem[])
    .filter((item): item is Extract<PushItem, { type: 'note' }> => item.type === 'note');
}

describe('deferred sign-in, across the real AuthProvider', () => {
  it('files a signed-out write under a local id and keeps it across a reload', async () => {
    const first = mount();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(screen.getByTestId('dataUserId').textContent).toMatch(/^local-/);
    const localId = screen.getByTestId('localUserId').textContent!;

    await userEvent.click(screen.getByText('write note'));
    expect(screen.getByTestId('note')).toHaveTextContent('made before signing in');
    await settle();
    first.unmount();

    mount();
    await waitFor(() => expect(screen.getByTestId('note')).toHaveTextContent('made before signing in'));
    expect(screen.getByTestId('localUserId')).toHaveTextContent(localId);
  });

  it('adopts that work when the session resolves signed in (the in-page path)', async () => {
    // The session check answers after the first render, which is what happens for real: the
    // provider mounts against the local id and swaps to the account a moment later.
    const first = mount();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    await userEvent.click(screen.getByText('write note'));
    await settle();
    first.unmount();

    // The server starts with nothing, so anything it can hand back has to have got there by being
    // pushed — which is to say by adoption.
    authMe.mockResolvedValue({ user: ACCOUNT });
    mount();

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent(`signed-in:${ACCOUNT.id}`));
    await waitFor(() => expect(screen.getByTestId('note')).toHaveTextContent('made before signing in'));
    // And it actually reached the server, rather than merely surviving locally.
    await waitFor(() => expect(pushedNotes()).not.toHaveLength(0));
    expect(pushedNotes()[0].text).toBe('made before signing in');
    // Adopted records are pushed, not just carried: the queue drains rather than sitting dirty
    // forever with the note only ever living on this device.
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('0'));
  });

  it('retires the account copy and mints a fresh local id on sign-out', async () => {
    authMe.mockResolvedValue({ user: ACCOUNT });
    dataApiAll.mockResolvedValue({
      ...structuredClone(emptyData),
      notes: { dn1: { text: 'from the server', m: '2030-01-01T00:00:00.000Z|server' } },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('note')).toHaveTextContent('from the server'));
    const localBefore = screen.getByTestId('localUserId').textContent!;

    authMe.mockResolvedValue({ user: null });
    await userEvent.click(screen.getByText('sign out'));

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('signed-out'));
    await waitFor(() => expect(screen.getByTestId('note')).toHaveTextContent(''));
    const localAfter = screen.getByTestId('localUserId').textContent!;
    expect(localAfter).not.toBe(localBefore);
    expect(localStorage.getItem(LOCAL_USER_KEY)).toBe(localAfter);
  });
});
