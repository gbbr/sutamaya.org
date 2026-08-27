import { navigate } from '@reach/router';
import { tagIntent } from '../lib/routeIntent';
import { READER_ORIGIN_KEY } from '../lib/storageKeys';

interface PersistedReaderOrigin {
  suttaId: string;
  from: string;
  fromView?: 'tree' | 'list';
}

// A hard refresh drops location.state entirely, losing `from`/`fromView` even for a reader opened
// moments earlier through LibraryPage.onOpen, which persists this alongside the router state it
// sets. Scoped by `suttaId`, so a direct link to a different /read/:id can't resurrect a stale
// origin from an unrelated reading session.
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

// Re-keys the persisted origin to whichever sutta is now being read, carrying `from`/`fromView`
// forward as router state already does (navigateToSutta below). Without it, a refresh partway
// through a Prev/Next run finds the entry still scoped to the original sutta and falls back to the
// bare corpus location instead of the origin pane.
function persistReaderOrigin(suttaId: string, from: string | undefined, fromView: 'tree' | 'list' | undefined) {
  if (!from) return;
  try {
    localStorage.setItem(READER_ORIGIN_KEY, JSON.stringify({ suttaId, from, fromView }));
  } catch {
    // storage unavailable — ignore
  }
}

// Where to return to on close: the exact pane, nodeId and scroll position the reader was opened
// from (LibraryPage's onOpen), not the sutta's bare corpus location. `fromView` rides alongside it
// on mobile, where LibraryPage shows one pane at a time, so closing lands on the right pane.
export function useReaderOrigin(locationState: { from?: string; fromView?: 'tree' | 'list' } | undefined) {
  const from = locationState?.from;
  const fromView = locationState?.fromView;

  // Navigates to another sutta's reader — Prev/Next, or opening a search result — persisting the
  // origin under the new sutta id first, so a refresh partway through a run still finds it.
  function navigateToSutta(nextSuttaId: string) {
    persistReaderOrigin(nextSuttaId, from, fromView);
    navigate(`/read/${encodeURIComponent(nextSuttaId)}`, { state: { from, fromView } });
  }

  // Closes the reader: router state first, then the persisted fallback (survives a hard
  // refresh), then `fallbackPath` for a direct/bookmarked link that never had an origin at all.
  function closeToOrigin(suttaId: string | undefined, fallbackPath: string) {
    // `restoreOrigin: true` marks a return-to-origin round trip rather than a fresh deep link,
    // which TreePane's Library/My-lists toggle has to tell apart. Only meaningful alongside `from`:
    // the fallback path below is a bare corpus location, not a return to anywhere the user was.
    // Tagged (lib/routeIntent.ts) so LibraryPage consumes `fromView` exactly once, and a later
    // refresh of the same URL can't resurrect it over a manual pane switch made since.
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
