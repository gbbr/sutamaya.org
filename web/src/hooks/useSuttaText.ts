import { useEffect, useMemo, useState } from 'react';
import { loadSuttaText, peekSuttaText, type SegmentFile } from '../lib/corpus';
import { retryWithBackoff } from '../lib/retry';

export function useSuttaText(uid: string | undefined) {
  // Already-loaded text — read earlier this session, or prefetched as a Prev/Next neighbour — is
  // taken synchronously, so stepping to it renders the text in the same commit as the title and
  // breadcrumb above it rather than one empty frame behind.
  const [segments, setSegments] = useState<SegmentFile[] | null>(() => peekSuttaText(uid) ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Swapped during render rather than in the effect below — React's "adjusting state when a prop
  // changes" pattern. The effect runs after the commit, so resetting there would paint the previous
  // sutta's segments under the new sutta's title for a frame.
  const [renderedUid, setRenderedUid] = useState(uid);
  if (uid !== renderedUid) {
    setRenderedUid(uid);
    setSegments(peekSuttaText(uid) ?? null);
    setError(false);
  }

  useEffect(() => {
    if (!uid || peekSuttaText(uid)) return;
    let cancelled = false;

    async function load() {
      try {
        const segs = await retryWithBackoff(() => loadSuttaText(uid!));
        if (!cancelled) setSegments(segs);
      } catch (err) {
        console.error('Failed to load sutta text', uid, err);
        if (!cancelled) setError(true);
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  const retry = useMemo(
    () => () => {
      setError(false);
      setAttempt((n) => n + 1);
    },
    []
  );

  return { segments, error, retry };
}
