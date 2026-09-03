import { navigate } from '@reach/router';
import { tagIntent } from '../lib/routeIntent';
import { READER_ORIGIN_KEY } from '../lib/storageKeys';

interface PersistedReaderOrigin {
  suttaId: string;
  from: string;
  fromView?: 'tree' | 'list';
}

// Reads the origin LibraryPage.onOpen persisted alongside its router state, which a hard refresh
// drops. Scoped by `suttaId`, so a link to a different sutta can't resurrect a stale origin.
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

// Re-keys the persisted origin to the sutta now being read, so a refresh partway through a
// Prev/Next run still finds it.
function persistReaderOrigin(suttaId: string, from: string | undefined, fromView: 'tree' | 'list' | undefined) {
  if (!from) return;
  try {
    localStorage.setItem(READER_ORIGIN_KEY, JSON.stringify({ suttaId, from, fromView }));
  } catch {
    // storage unavailable — ignore
  }
}

// Tracks where the reader was opened from and navigates back there. `from` is the pane and node to
// return to (LibraryPage's onOpen), `fromView` which pane to show on mobile; both survive a
// Prev/Next run and a hard refresh.
export function useReaderOrigin(locationState: { from?: string; fromView?: 'tree' | 'list' } | undefined) {
  const from = locationState?.from;
  const fromView = locationState?.fromView;

  // Opens another sutta in the reader, carrying the origin forward.
  // `segment` is where a search hit was found, and where the reader opens; Prev/Next pass none, and
  // carry the plain origin they always did rather than a one-shot intent with nothing in it.
  function navigateToSutta(nextSuttaId: string, segment?: number) {
    persistReaderOrigin(nextSuttaId, from, fromView);
    const state = segment === undefined ? { from, fromView } : tagIntent({ from, fromView, segment });
    navigate(`/read/${encodeURIComponent(nextSuttaId)}`, { state });
  }

  // Closes the reader, to the router state, else the persisted origin, else `fallbackPath` for a
  // link that never had an origin.
  function closeToOrigin(suttaId: string | undefined, fallbackPath: string) {
    // `restoreOrigin` marks a return rather than a fresh deep link, which TreePane's Library/My
    // lists toggle tells apart. Tagged (lib/routeIntent.ts) so LibraryPage consumes it once.
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
