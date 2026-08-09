import { useEffect, useMemo, useState } from 'react';
import { loadSuttaText, type SegmentFile } from '../lib/corpus';

// Mirrors AuthContext's own retry-with-backoff for a flaky network call: a couple of silent
// retries first (offline blips, a cold CDN edge), an `error` surfaced to the caller only once
// those are exhausted.
const RETRY_DELAYS_MS = [500, 1500, 3000];

export function useSuttaText(uid: string | undefined) {
  const [segments, setSegments] = useState<SegmentFile[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uid) {
      setSegments(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setSegments(null);
    setError(false);

    async function load() {
      for (let retry = 0; ; retry += 1) {
        try {
          const segs = await loadSuttaText(uid!);
          if (!cancelled) setSegments(segs);
          return;
        } catch (err) {
          if (retry >= RETRY_DELAYS_MS.length) {
            console.error('Failed to load sutta text', uid, err);
            if (!cancelled) setError(true);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[retry]));
        }
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  const retry = useMemo(() => () => setAttempt((n) => n + 1), []);

  return { segments, error, retry };
}
