import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Router, navigate } from '@reach/router';

// Covers the two behaviors added on top of the plain "renders the three sections" page: (1)
// Authentication is always the last section, regardless of sign-in state, and never collapses to
// nothing while `loading` — both needed for (2), the scrollTo:'offline'/'auth' deep-link effect
// (see promptGoogleSignIn in AuthContext, and the offline-download nudge in TreePane) to always
// have a real, correctly-positioned element to scroll to.

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: vi.fn() }));
vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));

import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
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
    googleReady: true,
    authError: null,
    loginWithGoogle: vi.fn(async () => {}),
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
    corpus: { nikayas: [], suttas: {}, sujatoCommit: 'abc123' } as unknown as Corpus,
    dictionary: null,
    loading: false,
    error: false,
    retry: vi.fn(),
  });
  vi.mocked(useUserData).mockReturnValue(mockUserData());
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
  it('is fixed — Display, then Offline, then Authentication — regardless of sign-in state', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: null }));
    const { container: signedOut } = renderSettings();
    const textOut = signedOut.textContent!;
    expect(textOut.indexOf('Display')).toBeLessThan(textOut.indexOf('Offline'));
    expect(textOut.indexOf('Offline')).toBeLessThan(textOut.indexOf('Authentication'));

    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    const { container: signedIn } = renderSettings();
    const textIn = signedIn.textContent!;
    expect(textIn.indexOf('Display')).toBeLessThan(textIn.indexOf('Offline'));
    expect(textIn.indexOf('Offline')).toBeLessThan(textIn.indexOf('Authentication'));
  });

  it('renders a placeholder — not nothing — for Authentication while the session check is loading', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ loading: true }));
    renderSettings();
    expect(screen.getByText('Authentication')).toBeInTheDocument();
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
    // Flash highlight applied immediately alongside the scroll — its fade-out is timer-driven
    // (see flashClass in SettingsPage), not asserted here to avoid coupling this test to that
    // exact duration.
    expect(offlineSection.className).toContain('bg-accent/10');
  });

  it('scrolls to the Authentication section when navigated here with scrollTo: "auth"', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    navigate('/settings', { state: { scrollTo: 'auth' } });
    render(
      <Router>
        <SettingsPage path="/settings" />
      </Router>
    );
    const authSection = screen.getByText('Authentication').parentElement!;
    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollSpy.mock.instances).toContain(authSection);
    expect(authSection.className).toContain('bg-accent/10');
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

  it('reports how long ago the last sync landed once drained', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    vi.mocked(useUserData).mockReturnValue(mockUserData({ syncStatus: 'synced', lastSyncedAt: fiveMinutesAgo }));
    renderSettings();
    expect(screen.getByText('Last synced 5 minutes ago.')).toBeInTheDocument();
  });
});
