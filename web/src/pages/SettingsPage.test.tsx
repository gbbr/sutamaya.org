import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router, navigate } from '@reach/router';

// Covers the two behaviors added on top of the plain "renders the three sections" page: (1)
// Account is always the last section, regardless of sign-in state, and never collapses to
// nothing while `loading` — both needed for (2), the scrollTo:'offline'/'auth' deep-link effect
// (see promptGoogleSignIn in AuthContext, and the offline-download nudge in TreePane) to always
// have a real, correctly-positioned element to scroll to.

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: vi.fn() }));
vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
vi.mock('../lib/offline', () => ({
  estimateOfflineStatus: vi.fn(async () => ({ cached: 0, total: 10 })),
  prefetchAllSuttas: vi.fn(async () => ({ failed: [], circuitTripped: false })),
  prefetchDictionary: vi.fn(async () => true),
  prefetchHelpImages: vi.fn(async () => true),
  cachedCorpusVersions: vi.fn(() => ({ data: null, dictionary: null })),
  recordCachedCorpusVersion: vi.fn(),
  isOfflineTextStale: vi.fn(() => false),
}));

import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import {
  cachedCorpusVersions,
  isOfflineTextStale,
  prefetchAllSuttas,
  prefetchDictionary,
  recordCachedCorpusVersion,
} from '../lib/offline';
import { SettingsPage } from './SettingsPage';
import type { Corpus, User } from '../lib/types';

function mockUserData(overrides: Partial<ReturnType<typeof useUserData>> = {}): ReturnType<typeof useUserData> {
  return {
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
    createList: vi.fn(async () => {
      throw new Error('unused');
    }),
    renameList: vi.fn(async () => {}),
    removeList: vi.fn(async () => {}),
    setListParent: vi.fn(async () => {}),
    reorderLists: vi.fn(async () => {}),
    reorderListItems: vi.fn(async () => {}),
    toggleMembership: vi.fn(async () => {}),
    addToList: vi.fn(async () => {}),
    submitNote: vi.fn(async () => {}),
    setHighlightRanges: vi.fn(async () => {}),
    markVisited: vi.fn(),
    ...overrides,
  };
}

function buildUser(): User {
  return { id: 'u1', email: 'a@b.com', name: 'A B', picture: null };
}

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}): ReturnType<typeof useAuth> {
  const merged = {
    user: null as User | null,
    loading: false,
    authError: null,
    requestEmailCode: vi.fn(async () => {}),
    signInWithEmailCode: vi.fn(async () => {}),
    promptGoogleSignIn: vi.fn(),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
  // Derived from `user` rather than passed in, so a test that signs someone in by overriding
  // `user` alone still gets a coherent auth state (see AuthContext, where these track it too).
  return { ...merged, isSignedIn: !!merged.user, dataUserId: merged.user?.id ?? 'local-test', localUserId: 'local-test' };
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue(mockAuth());
  vi.mocked(useUiPrefs).mockReturnValue({
    uiScale: 1,
    theme: 'light',
    resolvedTheme: 'light',
    setUiScale: vi.fn(),
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  });
  vi.mocked(useCorpus).mockReturnValue({
    corpus: { nikayas: [], suttas: {}, sujatoCommit: 'abc123', dataVersion: 'data-v2', dictionaryVersion: 'dict-v2' } as unknown as Corpus,
    loading: false,
    error: false,
    retry: vi.fn(),
  });
  vi.mocked(useUserData).mockReturnValue(mockUserData());
  // Offline-module mocks are module-level singletons, so both their return values and their call
  // counts survive from one test to the next unless reset here. Default to the ordinary state:
  // nothing downloaded before, nothing stale, every download succeeding.
  vi.mocked(isOfflineTextStale).mockReturnValue(false);
  vi.mocked(cachedCorpusVersions).mockReturnValue({ data: null, dictionary: null });
  vi.mocked(prefetchAllSuttas).mockClear().mockResolvedValue({ failed: [], circuitTripped: false });
  vi.mocked(prefetchDictionary).mockClear().mockResolvedValue(true);
  vi.mocked(recordCachedCorpusVersion).mockClear();
});

function renderSettings(path = '/settings') {
  navigate(path);
  return render(
    <Router>
      <SettingsPage path="/settings" />
    </Router>
  );
}

describe('section order', () => {
  it('is fixed — Account, then Offline, then Display — regardless of sign-in state', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: null }));
    const { container: signedOut } = renderSettings();
    const textOut = signedOut.textContent!;
    expect(textOut.indexOf('Account')).toBeLessThan(textOut.indexOf('Offline'));
    expect(textOut.indexOf('Offline')).toBeLessThan(textOut.indexOf('Display'));

    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    const { container: signedIn } = renderSettings();
    const textIn = signedIn.textContent!;
    expect(textIn.indexOf('Account')).toBeLessThan(textIn.indexOf('Offline'));
    expect(textIn.indexOf('Offline')).toBeLessThan(textIn.indexOf('Display'));
  });

  it('renders a placeholder — not nothing — for Account while the session check is loading', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ loading: true }));
    renderSettings();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Checking sign-in status…')).toBeInTheDocument();
  });
});

describe('scrollTo deep link', () => {
  it('scrolls to the Offline section when navigated here with scrollTo: "offline"', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    navigate('/settings', { state: { scrollTo: 'offline' } });
    render(
      <Router>
        <SettingsPage path="/settings" />
      </Router>
    );
    const offlineSection = screen.getByText('Offline').parentElement!;
    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollSpy.mock.instances).toContain(offlineSection);
    // Flash highlight applied immediately alongside the scroll, to the section's card (the
    // sibling below the heading the scroll targets — see cardClass in SettingsPage). Its
    // fade-out is timer-driven, not asserted here to avoid coupling this test to that exact
    // duration.
    expect(screen.getByText('Offline').nextElementSibling!.className).toContain('border-accent');
  });

  it('scrolls to the Account section when navigated here with scrollTo: "auth"', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    navigate('/settings', { state: { scrollTo: 'auth' } });
    render(
      <Router>
        <SettingsPage path="/settings" />
      </Router>
    );
    const authSection = screen.getByText('Account').parentElement!;
    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollSpy.mock.instances).toContain(authSection);
    expect(screen.getByText('Account').nextElementSibling!.className).toContain('border-accent');
  });

  it('does not scroll at all when arriving without a scrollTo state', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    renderSettings();
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

describe('sync status line', () => {
  it('is absent while signed out — there is nothing to sync', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: null }));
    renderSettings();
    expect(screen.queryByText('Not synced yet.')).not.toBeInTheDocument();
  });

  it('shows once signed in, before anything has ever synced', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    renderSettings();
    expect(screen.getByText('Not synced yet.')).toBeInTheDocument();
  });

  it('reports a queued write while signed in', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    vi.mocked(useUserData).mockReturnValue(mockUserData({ syncStatus: 'pending', pendingCount: 2 }));
    renderSettings();
    expect(screen.getByText('Syncing 2 changes…')).toBeInTheDocument();
  });

  it('reports offline', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    vi.mocked(useUserData).mockReturnValue(mockUserData({ syncStatus: 'offline' }));
    renderSettings();
    expect(screen.getByText(/Offline — changes are saved locally/)).toBeInTheDocument();
  });


  // `user` stays populated through a lapsed session (lib/lastUser.ts — clearing it would mount an
  // empty mirror over a full one), so without this branch the section renders as an ordinary
  // signed-in account and TreePane's re-auth banner points at a sign-in button that isn't there.
  it('offers a way back in when the session has lapsed, without pretending the queue is moving', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    vi.mocked(useUserData).mockReturnValue(mockUserData({ needsReauth: true, syncStatus: 'pending', pendingCount: 2 }));
    renderSettings();

    expect(screen.getByText(/Your session expired/)).toBeInTheDocument();
    expect(document.querySelector('[data-component="GoogleSignInButton"]')).toBeInTheDocument();
    expect(screen.queryByText('Syncing 2 changes…')).not.toBeInTheDocument();
    // A plain link to a requireAuth route would only answer 401 and download an error body.
    expect(screen.queryByText('Export my data')).not.toBeInTheDocument();
    // Still their account, and POST /api/auth/logout is unauthenticated, so leaving still works.
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('reports how long ago the last sync landed once drained', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    vi.mocked(useUserData).mockReturnValue(mockUserData({ syncStatus: 'synced', lastSyncedAt: fiveMinutesAgo }));
    renderSettings();
    expect(screen.getByText('Last synced 5 minutes ago.')).toBeInTheDocument();
  });
});


describe('refreshing a stale offline copy', () => {
  it('announces the update and offers a re-download instead of the first-time download', async () => {
    vi.mocked(isOfflineTextStale).mockReturnValue(true);
    renderSettings();
    expect(await screen.findByText('Updated content is available (50 MB).')).toBeInTheDocument();
    expect(screen.getByText('Download updated content')).toBeInTheDocument();
    // The ordinary availability line is replaced, not shown alongside it.
    expect(screen.queryByText('All suttas available offline.')).not.toBeInTheDocument();
  });

  // Without forcing, prefetchAllSuttas skips every already-cached uid and the "refresh" replaces
  // nothing while still reporting success.
  it('refetches every sutta shard when the cached text is behind the build', async () => {
    vi.mocked(isOfflineTextStale).mockReturnValue(true);
    vi.mocked(cachedCorpusVersions).mockReturnValue({ data: 'data-v1', dictionary: 'dict-v2' });
    renderSettings();
    await userEvent.click(screen.getByText('Download updated content'));
    expect(vi.mocked(prefetchAllSuttas).mock.calls[0][1]).toMatchObject({ force: true });
    // Dictionary version unchanged — a reworded sutta must not cost a ~2.6MB re-fetch.
    expect(vi.mocked(prefetchDictionary).mock.calls[0][1]).toBe(false);
  });

  it('refetches the dictionary only when the dictionary itself changed', async () => {
    vi.mocked(cachedCorpusVersions).mockReturnValue({ data: 'data-v2', dictionary: 'dict-v1' });
    renderSettings();
    await userEvent.click(screen.getByText('Download all content'));
    expect(vi.mocked(prefetchDictionary).mock.calls[0][1]).toBe(true);
    expect(vi.mocked(prefetchAllSuttas).mock.calls[0][1]).toMatchObject({ force: false });
  });

  // A device that has never completed a download can't vouch for whatever ordinary browsing left
  // in the cache, so it refetches everything — but nothing is deleted up front, so a download that
  // fails or is cancelled can't leave it with less offline text than it started with.
  it('refetches everything, without clearing, on a first-ever download', async () => {
    renderSettings();
    await userEvent.click(screen.getByText('Download all content'));
    expect(vi.mocked(prefetchAllSuttas).mock.calls[0][1]).toMatchObject({ force: true });
    expect(vi.mocked(prefetchDictionary).mock.calls[0][1]).toBe(true);
  });

  it('records both versions once the download finishes cleanly', async () => {
    renderSettings();
    await userEvent.click(screen.getByText('Download all content'));
    expect(recordCachedCorpusVersion).toHaveBeenCalledWith('data', 'data-v2');
    expect(recordCachedCorpusVersion).toHaveBeenCalledWith('dictionary', 'dict-v2');
  });

  // A partial download leaves the recorded version alone, so the nudge keeps reporting the copy as
  // behind rather than declaring it current over a half-replaced cache.
  it('leaves the recorded text version alone when some suttas failed', async () => {
    vi.mocked(prefetchAllSuttas).mockResolvedValue({ failed: ['dn1'], circuitTripped: false });
    renderSettings();
    await userEvent.click(screen.getByText('Download all content'));
    expect(recordCachedCorpusVersion).not.toHaveBeenCalledWith('data', 'data-v2');
    expect(recordCachedCorpusVersion).toHaveBeenCalledWith('dictionary', 'dict-v2');
  });
});
