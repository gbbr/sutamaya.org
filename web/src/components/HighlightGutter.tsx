import { useEffect, useState, type RefObject } from 'react';
import type { HighlightGroup } from '../lib/highlights';
import { getUiScale } from '../lib/uiPrefs';
import { highlightPaint } from '../lib/theme';
import type { ThemeColors } from '../lib/types';
import { computeGutterLayout, type GutterMark, type GutterTrack } from '../lib/highlightGutterLayout';

interface HighlightGutterProps {
  scrollRef: RefObject<HTMLElement>;
  highlightGroups: HighlightGroup[];
  theme: ThemeColors;
  onJump: (segIndex: number, highlightId?: string) => void;
  // Recomputed whenever this changes, in addition to on mount/highlight-change/resize — pass
  // anything that can reflow the text without resizing the scroll container itself (font size,
  // line height, face, Pali-always-shown, or the sutta's segments going from not-yet-loaded to
  // loaded — the container's own box, fixed by the surrounding flex layout, doesn't change size
  // either way), since a ResizeObserver on the container won't catch that on its own.
  layoutKey?: string | number;
}

// RainDrop-style: a thin strip of colour marks along the edge of the scroll area, one per
// highlight, positioned at the same relative height its text sits at in the scrollable content
// — so a mark's position is where the scrollbar thumb would be if that highlight were on
// screen. Clicking one jumps straight to it.
export function HighlightGutter({ scrollRef, highlightGroups, theme, onJump, layoutKey }: HighlightGutterProps) {
  const [marks, setMarks] = useState<GutterMark[]>([]);
  const [track, setTrack] = useState<GutterTrack | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || highlightGroups.length === 0) {
      setMarks([]);
      setTrack(null);
      return;
    }

    function recompute() {
      if (!container) return;
      // getBoundingClientRect() reports real, post-`zoom` screen coordinates, but scrollTop/
      // scrollHeight are local (pre-zoom) layout units — same distinction index.css's 100dvh
      // compensation deals with (see applyUiScale). computeGutterLayout converts the rect values
      // to local units before mixing them with scroll units — see its own comment.
      const { track, marks } = computeGutterLayout(
        highlightGroups,
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
  }, [scrollRef, highlightGroups, layoutKey]);

  if (!track || marks.length === 0) return null;

  return (
    <div
      data-component="HighlightGutter"
      className="fixed z-40"
      style={{ top: track.top, height: track.height, right: 4, width: 24, pointerEvents: 'none' }}
    >
      {marks.map((m) => (
        <button
          key={m.key}
          className="absolute w-[11px] hover:w-[20px] rounded-[2px] shadow-sm transition-[width] duration-150 ease-out"
          style={{ background: highlightPaint(m.c, theme), height: 6, top: m.top - 3, right: 0, pointerEvents: 'auto' }}
          title="Jump to highlight"
          onClick={() => onJump(m.i, m.key)}
        />
      ))}
    </div>
  );
}
