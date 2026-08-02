import { useEffect, useState } from 'react';
import { loadSuttaText, type SegmentFile } from '../lib/corpus';

export function useSuttaText(uid: string | undefined) {
  const [segments, setSegments] = useState<SegmentFile[] | null>(null);

  useEffect(() => {
    if (!uid) {
      setSegments(null);
      return;
    }
    let cancelled = false;
    setSegments(null);
    loadSuttaText(uid).then((segs) => {
      if (!cancelled) setSegments(segs);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return segments;
}
