import { useNavigate, type NavigateOptions } from 'react-router';
import { transitionPage } from '../lib/ui/motion';
import { tagIntent } from '../lib/navigation/routeIntent';
import { readLink, type Passage } from '../lib/navigation/passageLink';
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
// is the sutta the last jump from within the reader left: the way back, one jump at a time
// (docs/web-app.md's "Routing"). It lasts as long as the history entry does.
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

  // Opens a hit from the reader's own search, or a link in a translator's note, leaving the library
  // search's run behind. `passage` is where the reader opens: the segments a hit's snippet was drawn
  // from or a link names, those whose Pali shows open, and what its words were marked by. `leaving`
  // is the sutta the jump leaves, which becomes the way back: each jump is a step in the history,
  // one to another line of the same sutta included. A jump onto the sutta the way back leads to is
  // that way back, returning to it where the reader left it — unless the jump names a passage there
  // to open instead.
  function jumpTo(
    nextSuttaId: string,
    passage?: Passage,
    leaving?: string
  ) {
    if (nextSuttaId === backTo && !passage) {
      goBack();
      return;
    }
    persistReaderOrigin(nextSuttaId, from, fromView, undefined);
    const state = { from, fromView, backTo: leaving ?? backTo };
    navigate(readLink(nextSuttaId, passage), {
      // A fresh arrival every time, so a jump to where the reader already is scrolls and washes again.
      state: tagIntent(
        passage
          ? { ...state, segments: passage.segments, paliSegments: passage.paliSegments, markedBy: passage.markedBy }
          : state
      ),
      replace: !leaving,
    });
  }

  // Returns to `backTo`, the history entry behind this one.
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
    // lists toggle tells apart. Tagged (lib/navigation/routeIntent.ts) so LibraryPage consumes it
    // once.
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
