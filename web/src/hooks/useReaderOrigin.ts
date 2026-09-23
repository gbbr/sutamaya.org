import { useNavigate, type NavigateOptions } from 'react-router';
import { transitionPage } from '../lib/motion';
import { tagIntent } from '../lib/routeIntent';
import { READER_ORIGIN_KEY } from '../lib/storageKeys';

interface PersistedReaderOrigin {
  suttaId: string;
  from: string;
  fromView?: 'tree' | 'list';
  searchIds?: string[];
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
function persistReaderOrigin(
  suttaId: string,
  from: string | undefined,
  fromView: 'tree' | 'list' | undefined,
  searchIds: string[] | undefined
) {
  if (!from) return;
  try {
    localStorage.setItem(READER_ORIGIN_KEY, JSON.stringify({ suttaId, from, fromView, searchIds }));
  } catch {
    // storage unavailable — ignore
  }
}

// Tracks where the reader was opened from and navigates back there. `from` is the pane and node to
// return to (LibraryPage's onOpen), `fromView` which pane to show on mobile, `searchIds` the hits a
// library search opened this sutta from; all survive a Prev/Next run and a hard refresh. `backTo`
// is the sutta the reader first jumped from with the reader's own search: the one way back, however
// far they go from there (docs/web-app.md's "Routing"). It lasts as long as the history entry does.
export function useReaderOrigin(
  locationState: { from?: string; fromView?: 'tree' | 'list'; searchIds?: string[]; backTo?: string } | undefined
) {
  const navigate = useNavigate();
  const from = locationState?.from;
  const fromView = locationState?.fromView;
  const searchIds = locationState?.searchIds;
  const backTo = locationState?.backTo;

  // Turns the page to the sutta before or after, in the current one's place: the origin, the
  // library search's run and the way back all carry over. Turning onto the sutta the way back leads
  // to is that way back.
  function turnTo(nextSuttaId: string) {
    if (nextSuttaId === backTo) {
      goBack();
      return;
    }
    persistReaderOrigin(nextSuttaId, from, fromView, searchIds);
    navigate(`/read/${encodeURIComponent(nextSuttaId)}`, {
      state: { from, fromView, searchIds, backTo },
      replace: true,
    });
  }

  // Opens a hit from the reader's own search, leaving the library search's run behind. `passage`
  // is where its snippet was drawn from, where the reader opens: its segments, and those whose Pali
  // shows open. `leaving` is the sutta a jump to another one leaves, which becomes the way back
  // unless there is one already: a single step, however far the reader goes from there. Landing
  // back on that sutta ends the detour, returning to it where the reader left it — unless the hit
  // names a passage there to open instead.
  function jumpTo(
    nextSuttaId: string,
    passage?: { segments: [number, number]; paliSegments?: number[] },
    leaving?: string
  ) {
    if (nextSuttaId === backTo && !passage) {
      goBack();
      return;
    }
    persistReaderOrigin(nextSuttaId, from, fromView, undefined);
    const state = { from, fromView, backTo: nextSuttaId === backTo ? undefined : backTo ?? leaving };
    navigate(`/read/${encodeURIComponent(nextSuttaId)}`, {
      state: passage
        ? tagIntent({ ...state, segments: passage.segments, paliSegments: passage.paliSegments })
        : state,
      replace: backTo !== undefined || !leaving,
    });
  }

  // Returns to `backTo`, the history entry behind this one: only the first jump adds an entry.
  function goBack() {
    navigate(-1);
  }

  // Leaves the Reader for a place in the Library, fading one into the other.
  function leaveReader(to: string, options?: NavigateOptions) {
    transitionPage('fade', () => navigate(to, { ...options, flushSync: true }));
  }

  // Closes the reader, to the router state, else the persisted origin, else `fallbackPath` for a
  // link that never had an origin.
  function closeToOrigin(suttaId: string | undefined, fallbackPath: string) {
    // `restoreOrigin` marks a return rather than a fresh deep link, which TreePane's Library/My
    // lists toggle tells apart. Tagged (lib/routeIntent.ts) so LibraryPage consumes it once.
    if (from) {
      leaveReader(from, { state: tagIntent({ fromView, restoreOrigin: true }) });
      return;
    }
    const persisted = readPersistedReaderOrigin(suttaId);
    if (persisted) {
      leaveReader(persisted.from, { state: tagIntent({ fromView: persisted.fromView, restoreOrigin: true }) });
      return;
    }
    leaveReader(fallbackPath);
  }

  return { from, fromView, searchIds, backTo, turnTo, jumpTo, goBack, closeToOrigin, leaveReader };
}
