import { useEffect, useState, type RefObject } from 'react';
import { getUiScale } from '../lib/uiPrefs';
import { highlightPaint } from '../lib/theme';
import type { SegmentFile } from '../lib/corpus/corpus';
import type { Highlight, ThemeColors } from '../lib/types';
import { computeGutterLayout, markHitAreas, type GutterMark, type GutterTrack } from '../lib/highlightGutterLayout';

// Width of a mark's touch area, the reader's side margin.
const HIT_WIDTH = 22;
// How far a mark's touch area reaches above and below it, with a finger.
const TOUCH_REACH = 22;
// How far a mark's touch area reaches above and below it with a mouse: the mark itself.
const MOUSE_REACH = 4;

interface HighlightGutterProps {
  scrollRef: RefObject<HTMLElement>;
  highlights: Highlight[];
  // The loaded text, which is what turns a highlight's stored segment keys back into the positions
  // its mark is placed at.
  segments: SegmentFile[];
  theme: ThemeColors;
  onJump: (segIndex: number, highlightId?: string) => void;
  // Changes whenever the text reflows without the scroll container resizing — type size, face,
  // the segments arriving.
  layoutKey?: string | number;
}

// A strip of marks along the edge of the scroll area, one per highlight, each at the height its
// text sits at in the whole document. Clicking one jumps to it.
export function HighlightGutter({ scrollRef, highlights, segments, theme, onJump, layoutKey }: HighlightGutterProps) {
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
        segments,
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
  }, [scrollRef, highlights, segments, layoutKey]);

  if (!track || marks.length === 0) return null;
  const reach = window.matchMedia?.('(pointer: coarse)').matches ? TOUCH_REACH : MOUSE_REACH;
  const hits = markHitAreas(marks, track.height, reach);

  return (
    <div
      data-component="HighlightGutter"
      className="fixed z-40"
      style={{ top: track.top, height: track.height, right: 0, width: HIT_WIDTH, pointerEvents: 'none' }}
    >
      {marks.map((m, n) => (
        <button
          key={m.key}
          className="group absolute inset-x-0"
          style={{ top: hits[n].top, height: hits[n].height, pointerEvents: 'auto' }}
          title="Jump to highlight"
          onClick={() => onJump(m.i, m.key)}
        >
          <span
            className="absolute w-[13px] group-hover:w-[23px] rounded-[2px] shadow-sm transition-[width] duration-150 ease-out"
            style={{ background: highlightPaint(m.c, theme), height: 8, top: m.top - hits[n].top - 4, right: 4 }}
          />
        </button>
      ))}
    </div>
  );
}
