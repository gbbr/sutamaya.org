import { useEffect, useState, type RefObject } from 'react';
import { getUiScale } from '../lib/uiPrefs';
import { highlightPaint } from '../lib/theme';
import type { Highlight, ThemeColors } from '../lib/types';
import { computeGutterLayout, type GutterMark, type GutterTrack } from '../lib/highlightGutterLayout';

interface HighlightGutterProps {
  scrollRef: RefObject<HTMLElement>;
  highlights: Highlight[];
  theme: ThemeColors;
  onJump: (segIndex: number, highlightId?: string) => void;
  // Changes whenever the text reflows without the scroll container resizing — type size, face,
  // the segments arriving.
  layoutKey?: string | number;
}

// A strip of marks along the edge of the scroll area, one per highlight, each at the height its
// text sits at in the whole document. Clicking one jumps to it.
export function HighlightGutter({ scrollRef, highlights, theme, onJump, layoutKey }: HighlightGutterProps) {
  const [marks, setMarks] = useState<GutterMark[]>([]);
  const [track, setTrack] = useState<GutterTrack | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || highlights.length === 0) {
      setMarks([]);
      setTrack(null);
      return;
    }

    function recompute() {
      if (!container) return;
      // The rects are post-`zoom` and the scroll properties aren't; computeGutterLayout converts
      // before mixing them.
      const { track, marks } = computeGutterLayout(
        highlights,
        container.getBoundingClientRect(),
        container.scrollHeight,
        container.scrollTop,
        getUiScale(),
        (i) => container.querySelector<HTMLElement>(`[data-seg="${i}"]`)?.getBoundingClientRect().top
      );
      setTrack(track);
      setMarks(marks);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, highlights, layoutKey]);

  if (!track || marks.length === 0) return null;

  return (
    <div
      data-component="HighlightGutter"
      className="fixed z-40"
      style={{ top: track.top, height: track.height, right: 4, width: 28, pointerEvents: 'none' }}
    >
      {marks.map((m) => (
        <button
          key={m.key}
          className="absolute w-[13px] hover:w-[23px] rounded-[2px] shadow-sm transition-[width] duration-150 ease-out"
          style={{ background: highlightPaint(m.c, theme), height: 8, top: m.top - 4, right: 0, pointerEvents: 'auto' }}
          title="Jump to highlight"
          onClick={() => onJump(m.i, m.key)}
        />
      ))}
    </div>
  );
}
