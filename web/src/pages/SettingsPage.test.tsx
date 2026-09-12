import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoutes, type RouteEntry } from '../testRouter';
import { LayoutProvider } from '../context/LayoutContext';

// Covers the two behaviors added on top of the plain "renders the three sections" page: (1)
// Account is always the last section, regardless of sign-in state, and never collapses to
// nothing while `loading` — both needed for (2), the scrollTo:'offline'/'auth' deep-link effect
// (see promptGoogleSignIn in AuthContext, and the offline-download nudge in TreePane) to always
// have a real, correctly-positioned element to scroll to.

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/UiPrefsContext', () => ({ useUiPrefs: vi.fn() }));
vi.mock('../context/CorpusContext', () => ({ useCorpus: vi.fn() }));
vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
// The page asks `/api/data` whether an account is already gone when a deletion reports failure.
vi.mock('../lib/api', () => ({
  dataApi: { all: vi.fn(), exportUrl: '/api/data/export' },
}));
vi.mock('../lib/offline', () => ({
  estimateOfflineStatus: vi.fn(async () => ({ cached: 0, total: 10 })),
  lastOfflineStatus: vi.fn(() => null),
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
import { dataApi } from '../lib/api';
import {
  cachedCorpusVersions,
  estimateOfflineStatus,
  isOfflineTextStale,
  lastOfflineStatus,
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
    reorderLists: vi.fn(async () => {}),
    reorderListItems: vi.fn(async () => {}),
    toggleMembership: vi.fn(async () => {}),
    addToList: vi.fn(async () => {}),
    submitNote: vi.fn(async () => {}),
    setHighlightSpan: vi.fn(async () => {}),
    anchorHighlights: vi.fn(),
    markVisited: vi.fn(),
    putAside: [],
    putSuttaAside: vi.fn(),
    trackPutAside: vi.fn(),
    dropPutAside: vi.fn(),
    clearPutAside: vi.fn(),
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
    signingIn: false,
    requestEmailCode: vi.fn(async () => {}),
    signInWithEmailCode: vi.fn(async () => {}),
    signInWithGoogleNative: vi.fn(async () => {}),
    promptGoogleSignIn: vi.fn(),
    logout: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    forgetAccount: vi.fn(async () => {}),
    ...overrides,
  };
  // Derived from `user` rather than passed in, so a test that signs someone in by overriding
  // `user` alone still gets a coherent auth state (see AuthContext, where these track it too).
  return { ...merged, isSignedIn: !!merged.user, dataUserId: merged.user?.id ?? 'local-test', localUserId: 'local-test' };
}

/** An ApiError as lib/api throws one — `statusOf` reads the status off it. */
function httpError(status: number) {
  return Object.assign(new Error(`Request failed (${status})`), { status });
}

beforeEach(() => {
  // Unreachable by default: a network failure carries no status, so it says nothing either way
  // about whether the account survived.
  vi.mocked(dataApi.all).mockRejectedValue(new Error('offline'));
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
  vi.mocked(lastOfflineStatus).mockReturnValue(null);
  vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 0, total: 10 });
  vi.mocked(cachedCorpusVersions).mockReturnValue({ data: null, dictionary: null });
  vi.mocked(prefetchAllSuttas).mockClear().mockResolvedValue({ failed: [], circuitTripped: false });
  vi.mocked(prefetchDictionary).mockClear().mockResolvedValue(true);
  vi.mocked(recordCachedCorpusVersion).mockClear();
});

function renderSettings(entry: RouteEntry = '/settings') {
  return renderRoutes(
    [
      {
        path: '/settings',
        element: (
          <LayoutProvider>
            <SettingsPage />
          </LayoutProvider>
        ),
      },
    ],
    entry
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

// Both cards state what they know before their slow checks answer, so the page lands at the height
// it keeps: a placeholder that grows into a full card shoves everything below it down while the
// reader is already reading.
describe('opening without reflow', () => {
  it('shows a remembered account at once, without waiting on the session check', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), loading: true }));
    renderSettings();
    expect(screen.queryByText('Checking sign-in status…')).not.toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
  });

  it('states what a download costs before the availability count arrives', async () => {
    const { container } = renderSettings();
    expect(container.textContent).toContain('It downloads about 10 MB and uses about 60 MB on this device.');
    // Only the line above it is still unknown, and it is one line either way.
    expect(container.textContent).toContain('Checking how much is available offline…');
    expect(await screen.findByText('Currently 0% is available offline.')).toBeInTheDocument();
    expect(container.textContent).toContain('It downloads about 10 MB and uses about 60 MB on this device.');
  });

  it('opens on the count it last measured, rather than measuring before it can say anything', () => {
    vi.mocked(lastOfflineStatus).mockReturnValue({ cached: 5, total: 10 });
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 5, total: 10 });
    renderSettings();
    expect(screen.getByText('Currently 50% is available offline.')).toBeInTheDocument();
  });

  it('says so outright when the remembered count is everything', () => {
    vi.mocked(lastOfflineStatus).mockReturnValue({ cached: 10, total: 10 });
    vi.mocked(estimateOfflineStatus).mockResolvedValue({ cached: 10, total: 10 });
    renderSettings();
    expect(screen.getByText('All content available offline.')).toBeInTheDocument();
  });
});

describe('scrollTo deep link', () => {
  it('scrolls to the Offline section when navigated here with scrollTo: "offline"', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    renderSettings({ pathname: '/settings', state: { scrollTo: 'offline' } });
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
    renderSettings({ pathname: '/settings', state: { scrollTo: 'auth' } });
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
    // A plain link to a requireAuth route would only answer 401 and download an error body — which
    // takes the Danger zone's copy of it, and the whole card, with it.
    expect(screen.queryByText('Export my data')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete my account')).not.toBeInTheDocument();
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
    expect(await screen.findByText('Updated content is available (10 MB).')).toBeInTheDocument();
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

// Everything here guards one property: the account cannot be deleted by a single tap. Two steps,
// and the second one has to be typed.
describe('deleting the account', () => {
  it('is offered only when signed in, and only from the last section of the page', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: null }));
    const { container: signedOut } = renderSettings();
    expect(signedOut.textContent).not.toContain('Delete my account');

    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    const { container } = renderSettings();
    const text = container.textContent!;
    expect(text.indexOf('Display')).toBeLessThan(text.indexOf('Danger zone'));
    // Below Display, above the footer links, and nowhere near Sign out.
    expect(text.indexOf('Danger zone')).toBeLessThan(text.indexOf('Report an issue'));
  });

  it('is absent while the session check is still loading', () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), loading: true }));
    renderSettings();
    expect(screen.queryByText('Delete my account')).not.toBeInTheDocument();
  });

  it('carries an export of its own, so the data can be kept without leaving the card', async () => {
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
    const { container } = renderSettings();
    // Twice on the page now — the Account card's and this card's; the second is the one here.
    const links = [...container.querySelectorAll('a')].filter((a) => a.textContent === 'Export my data');
    expect(links).toHaveLength(2);
    expect(links[1].getAttribute('href')).toBe('/api/data/export');
  });

  it('asks for a typed confirmation, and does nothing until it matches', async () => {
    const deleteAccount = vi.fn(async () => {});
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), deleteAccount }));
    renderSettings();

    // Step one only arms the confirmation; nothing has been asked of the server.
    await userEvent.click(screen.getByText('Delete my account'));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/lists, notes, highlights and reading history, on every device/)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /Delete my account/ });
    expect(button).toBeDisabled();

    const field = screen.getByLabelText(/to confirm/);
    await userEvent.type(field, 'delete me');
    expect(button).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'DELETE');
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  // Reports the pointer the page is being driven with, for the two tests below. Restored by each
  // of them: nothing else in this file stubs matchMedia, and a leaked stub would answer every
  // media query in the tests that follow.
  function stubPointer(coarse: boolean) {
    return vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query: string) => ({ matches: coarse && query.includes('coarse'), media: query }) as MediaQueryList);
  }

  it('puts the cursor in the confirmation field where focusing raises no keyboard', async () => {
    const pointer = stubPointer(false);
    try {
      vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
      renderSettings();
      await userEvent.click(screen.getByText('Delete my account'));
      expect(screen.getByLabelText(/to confirm/)).toHaveFocus();
    } finally {
      pointer.mockRestore();
    }
  });

  // The keyboard an on-screen focus raises would cover the card this step just scrolled into view,
  // and the browser's own scroll-on-focus — suppressed so it can't fight that scroll — is what
  // would otherwise lift the field back above it. So the reader taps the field themselves, and the
  // OS places it.
  it('leaves the confirmation field unfocused on a touch screen', async () => {
    const pointer = stubPointer(true);
    try {
      vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser() }));
      renderSettings();
      await userEvent.click(screen.getByText('Delete my account'));
      expect(screen.getByLabelText(/to confirm/)).not.toHaveFocus();
    } finally {
      pointer.mockRestore();
    }
  });

  // The word is the reader's proof of intent, not a spelling test, and a phone capitalises the
  // first letter on its own.
  it('accepts the word whatever case it was typed in', async () => {
    const deleteAccount = vi.fn(async () => {});
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), deleteAccount }));
    renderSettings();

    await userEvent.click(screen.getByText('Delete my account'));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'Delete');
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('backs out cleanly, forgetting what was typed', async () => {
    const deleteAccount = vi.fn(async () => {});
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), deleteAccount }));
    renderSettings();

    await userEvent.click(screen.getByText('Delete my account'));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE');
    await userEvent.click(screen.getByText('Cancel'));
    expect(deleteAccount).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Delete my account'));
    expect(screen.getByRole('button', { name: /Delete my account/ })).toBeDisabled();
  });

  it('keeps the reader on the page, with the typed word intact, when the request fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deleteAccount = vi.fn(async () => {
      throw new Error('nope');
    });
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), deleteAccount }));
    renderSettings();

    await userEvent.click(screen.getByText('Delete my account'));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }));

    expect(await screen.findByText('Could not delete your account. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete my account/ })).toBeEnabled();
    errorSpy.mockRestore();
  });

  // A reply lost on the way back is indistinguishable, at the client, from a deletion that never
  // happened — and telling someone their account survived when it did not is the wrong way round to
  // be wrong about something permanent. `/api/data` answers 410 for an account that is gone, which
  // is what separates this from a lapsed session.
  it('finishes the job when the request failed but the account is already gone', async () => {
    const deleteAccount = vi.fn(async () => {
      throw new Error('the reply never arrived');
    });
    const forgetAccount = vi.fn(async () => {});
    vi.mocked(dataApi.all).mockRejectedValue(httpError(410));
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), deleteAccount, forgetAccount }));
    renderSettings();

    await userEvent.click(screen.getByText('Delete my account'));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }));

    // Retired here as a successful deletion would have done, and nothing is claimed to have failed.
    await vi.waitFor(() => expect(forgetAccount).toHaveBeenCalled());
    expect(screen.queryByText('Could not delete your account. Please try again.')).not.toBeInTheDocument();
  });

  // The opposite reading of the same failure: the account answers, so it is still there and the
  // deletion really did fail.
  it('reports failure when the account answers for itself', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const forgetAccount = vi.fn(async () => {});
    const deleteAccount = vi.fn(async () => {
      throw new Error('nope');
    });
    vi.mocked(dataApi.all).mockResolvedValue({} as Awaited<ReturnType<typeof dataApi.all>>);
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), deleteAccount, forgetAccount }));
    renderSettings();

    await userEvent.click(screen.getByText('Delete my account'));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }));

    expect(await screen.findByText('Could not delete your account. Please try again.')).toBeInTheDocument();
    expect(forgetAccount).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('says so plainly when the session lapsed before the confirmation was typed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deleteAccount = vi.fn(async () => {
      throw Object.assign(new Error('Request failed (401)'), { status: 401 });
    });
    vi.mocked(useAuth).mockReturnValue(mockAuth({ user: buildUser(), deleteAccount }));
    renderSettings();

    await userEvent.click(screen.getByText('Delete my account'));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }));

    expect(
      await screen.findByText('Your session has expired. Sign in again to delete your account.')
    ).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
