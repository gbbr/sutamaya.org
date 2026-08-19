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
  estimateOfflineStatus: vi.fn(async () => ({ cached: 0, total: 0 })),
  prefetchAllSuttas: vi.fn(async () => ({ failed: [], circuitTripped: false })),
  prefetchDictionary: vi.fn(async () => true),
  cachedCorpusVersions: vi.fn(() => ({ data: null, dictionary: null })),
  recordCachedCorpusVersion: vi.fn(),
  isOfflineTextStale: vi.fn(() => false),
  clearCachedText: vi.fn(async () => {}),
  clearCachedDictionary: vi.fn(async () => {}),
}));

import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import {
  cachedCorpusVersions,
  clearCachedDictionary,
  clearCachedText,
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
  return {
    user: null,
    loading: false,
    authError: null,
    requestEmailCode: vi.fn(async () => {}),
    signInWithEmailCode: vi.fn(async () => {}),
    promptGoogleSignIn: vi.fn(),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue(mockAuth());
  vi.mocked(useUiPrefs).mockReturnValue({
    uiScale: 1,
    uiFace: 'serif',
    theme: 'light',
    setUiScale: vi.fn(),
    setUiFace: vi.fn(),
    setTheme: vi.fn(),
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
  vi.mocked(prefetchAllSuttas).mockResolvedValue({ failed: [], circuitTripped: false });
  vi.mocked(prefetchDictionary).mockResolvedValue(true);
  vi.mocked(clearCachedText).mockClear();
  vi.mocked(clearCachedDictionary).mockClear();
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
  it('is fixed — Display, then Offline, then Account — regardless of sign-in state', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: null }));
    const { container: signedOut } = renderSettings();
    const textOut = signedOut.textContent!;
    expect(textOut.indexOf('Display')).toBeLessThan(textOut.indexOf('Offline'));
    expect(textOut.indexOf('Offline')).toBeLessThan(textOut.indexOf('Account'));

    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    const { container: signedIn } = renderSettings();
    const textIn = signedIn.textContent!;
    expect(textIn.indexOf('Display')).toBeLessThan(textIn.indexOf('Offline'));
    expect(textIn.indexOf('Offline')).toBeLessThan(textIn.indexOf('Account'));
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

  it('reports a stuck queue', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    vi.mocked(useUserData).mockReturnValue(mockUserData({ syncStatus: 'stuck' }));
    renderSettings();
    expect(screen.getByText(/couldn.t be synced/)).toBeInTheDocument();
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
    expect(screen.queryByText('Export my data as JSON')).not.toBeInTheDocument();
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
    expect(await screen.findByText('Updated sutta text is available.')).toBeInTheDocument();
    expect(screen.getByText('Re-download updated suttas')).toBeInTheDocument();
    // The ordinary availability line is replaced, not shown alongside it.
    expect(screen.queryByText('All suttas available offline.')).not.toBeInTheDocument();
  });

  // Without the clear, prefetchAllSuttas skips every already-cached uid and the "refresh" replaces
  // nothing while still reporting success.
  it('drops the sutta-text cache first when the cached text is behind the build', async () => {
    vi.mocked(isOfflineTextStale).mockReturnValue(true);
    vi.mocked(cachedCorpusVersions).mockReturnValue({ data: 'data-v1', dictionary: 'dict-v2' });
    renderSettings();
    await userEvent.click(screen.getByText('Re-download updated suttas'));
    expect(clearCachedText).toHaveBeenCalled();
    // Dictionary version unchanged — a reworded sutta must not cost a ~20MB re-fetch.
    expect(clearCachedDictionary).not.toHaveBeenCalled();
  });

  it('drops the dictionary cache only when the dictionary itself changed', async () => {
    vi.mocked(cachedCorpusVersions).mockReturnValue({ data: 'data-v2', dictionary: 'dict-v1' });
    renderSettings();
    await userEvent.click(screen.getByText('Download all suttas for offline'));
    expect(clearCachedDictionary).toHaveBeenCalled();
    expect(clearCachedText).not.toHaveBeenCalled();
  });

  it('records both versions once the download finishes cleanly', async () => {
    renderSettings();
    await userEvent.click(screen.getByText('Download all suttas for offline'));
    expect(recordCachedCorpusVersion).toHaveBeenCalledWith('data', 'data-v2');
    expect(recordCachedCorpusVersion).toHaveBeenCalledWith('dictionary', 'dict-v2');
  });

  // A partial download leaves the recorded version alone, so the nudge keeps reporting the copy as
  // behind rather than declaring it current over a half-replaced cache.
  it('leaves the recorded text version alone when some suttas failed', async () => {
    vi.mocked(prefetchAllSuttas).mockResolvedValue({ failed: ['dn1'], circuitTripped: false });
    renderSettings();
    await userEvent.click(screen.getByText('Download all suttas for offline'));
    expect(recordCachedCorpusVersion).not.toHaveBeenCalledWith('data', 'data-v2');
    expect(recordCachedCorpusVersion).toHaveBeenCalledWith('dictionary', 'dict-v2');
  });
});
