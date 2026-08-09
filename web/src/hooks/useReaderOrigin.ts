import { navigate } from '@reach/router';
import { tagIntent } from '../lib/routeIntent';
import { READER_ORIGIN_KEY } from '../lib/storageKeys';

interface PersistedReaderOrigin {
  suttaId: string;
  from: string;
  fromView?: 'tree' | 'list';
}

// A hard refresh drops location.state entirely (browser-native — a fresh navigation's history
// entry starts with none), losing `from`/`fromView` even for a reader opened moments earlier via
// LibraryPage.onOpen (which persists this alongside the router-state it also sets — see there).
// Scoped by `suttaId` so a direct/bookmarked link to a *different* /read/:id can't resurrect a
// stale origin left over from an unrelated earlier reading session.
function readPersistedReaderOrigin(suttaId: string | undefined): PersistedReaderOrigin | null {
  if (!suttaId) return null;
  try {
    const raw = localStorage.getItem(READER_ORIGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedReaderOrigin;
    return parsed.suttaId === suttaId ? parsed : null;
  } catch {
    return null;
  }
}

// Re-keys the persisted origin to whichever sutta is now being read, carrying the same
// `from`/`fromView` forward the same way router state already does (see navigateToSutta below)
// — otherwise a refresh partway through a Prev/Next run would find the persisted entry still
// scoped to the *original* sutta and fall back to the bare corpus location instead of the actual
// origin pane.
function persistReaderOrigin(suttaId: string, from: string | undefined, fromView: 'tree' | 'list' | undefined) {
  if (!from) return;
  try {
    localStorage.setItem(READER_ORIGIN_KEY, JSON.stringify({ suttaId, from, fromView }));
  } catch {
    // storage unavailable — ignore
  }
}

// Where to return to on close — the exact pane/nodeId/scroll position the reader was opened from
// (see LibraryPage's onOpen), not just the sutta's bare corpus location. `fromView` rides
// alongside it (mobile only — LibraryPage shows one pane at a time there) so closing lands back
// on the actual tree/list pane the reader was opened from.
export function useReaderOrigin(locationState: { from?: string; fromView?: 'tree' | 'list' } | undefined) {
  const from = locationState?.from;
  const fromView = locationState?.fromView;

  // Navigates to another sutta's reader (Prev/Next, or opening a search result), persisting the
  // origin under the *new* sutta id first so a refresh partway through a multi-step run still
  // finds it — see persistReaderOrigin's own comment.
  function navigateToSutta(nextSuttaId: string) {
    persistReaderOrigin(nextSuttaId, from, fromView);
    navigate(`/read/${encodeURIComponent(nextSuttaId)}`, { state: { from, fromView } });
  }

  // Closes the reader: router state first, then the persisted fallback (survives a hard
  // refresh), then `fallbackPath` for a direct/bookmarked link that never had an origin at all.
  function closeToOrigin(suttaId: string | undefined, fallbackPath: string) {
    // `restoreOrigin: true` marks this as a return-to-origin round trip (as opposed to a fresh
    // deep link) — see TreePane's own `restoreOrigin` prop for why its Library/My-lists toggle
    // needs to tell the two apart. Only meaningful alongside `from` itself: the fallback path
    // below is a bare corpus location, not a return to anywhere the user actually was. Tagged
    // (see lib/routeIntent.ts) so LibraryPage consumes `fromView` exactly once, rather than a
    // later refresh of the same URL resurrecting it over a manual pane switch made since.
    if (from) {
      navigate(from, { state: tagIntent({ fromView, restoreOrigin: true }) });
      return;
    }
    const persisted = readPersistedReaderOrigin(suttaId);
    if (persisted) {
      navigate(persisted.from, { state: tagIntent({ fromView: persisted.fromView, restoreOrigin: true }) });
      return;
    }
    navigate(fallbackPath);
  }

  return { from, fromView, navigateToSutta, closeToOrigin };
}
