import { useEffect, useMemo, useState } from 'react';
import { loadSuttaText, type SegmentFile } from '../lib/corpus';
import { retryWithBackoff } from '../lib/retry';

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

  const retry = useMemo(() => () => setAttempt((n) => n + 1), []);

  return { segments, error, retry };
}
