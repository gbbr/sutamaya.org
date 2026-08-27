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
  // Recomputed whenever this changes, on top of mount, highlight change and resize. Pass anything
  // that reflows the text without resizing the scroll container — font size, line height, face,
  // Pali-always-shown, or the sutta's segments arriving — since the container's own box is fixed by
  // the surrounding flex layout and a ResizeObserver on it sees none of that.
  layoutKey?: string | number;
}

// A thin strip of colour marks along the edge of the scroll area, one per highlight, each at the
// relative height its text sits at in the scrollable content — where the scrollbar thumb would be
// if that highlight were on screen. Clicking one jumps to it.
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
      // getBoundingClientRect() reports post-`zoom` screen coordinates, while scrollTop and
      // scrollHeight are pre-zoom layout units; computeGutterLayout converts the rect values to
      // local units before mixing the two.
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
