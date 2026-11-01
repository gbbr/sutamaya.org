import { useEffect, useMemo, useState } from 'react';
import { loadSuttaText, peekSuttaText, type SegmentFile } from '../lib/corpus/corpus';
import type { Translator } from '../lib/types';
import { retryWithBackoff } from '../lib/retry';

// Loads one sutta's segments, with a retry. Text already in loadSuttaText's cache — read earlier
// this session, or prefetched as a Prev/Next neighbour — is taken synchronously, so a step renders
// it in the same commit as the title above it.
export function useSuttaText(uid: string | undefined, by: Translator = 'sujato') {
  const [segments, setSegments] = useState<SegmentFile[] | null>(() => peekSuttaText(uid, by) ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The text the current segments belong to, as translator and uid. Swapped during render rather
  // than in an effect, which would paint the previous text's segments under the new one's title for
  // a frame.
  const textKey = `${by}/${uid}`;
  const [renderedKey, setRenderedKey] = useState(textKey);
  if (textKey !== renderedKey) {
    setRenderedKey(textKey);
    setSegments(peekSuttaText(uid, by) ?? null);
    setError(false);
  }

  useEffect(() => {
    if (!uid || peekSuttaText(uid, by)) return;
    let cancelled = false;

    async function load() {
      try {
        const segs = await retryWithBackoff(() => loadSuttaText(uid!, by));
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
  }, [uid, by, attempt]);

  const retry = useMemo(
    () => () => {
      setError(false);
      setAttempt((n) => n + 1);
    },
    []
  );

  return { segments, error, retry };
}
