import { useEffect, useState, type RefObject } from 'react';
import type { HighlightGroup } from '../lib/highlights';

interface Mark {
  key: string;
  i: number;
  c: string;
  top: number;
}

interface HighlightGutterProps {
  scrollRef: RefObject<HTMLElement>;
  highlightGroups: HighlightGroup[];
  onJump: (segIndex: number) => void;
  // Recomputed whenever this changes, in addition to on mount/highlight-change/resize — pass
  // anything that can reflow the text without resizing the scroll container itself (font size,
  // line height, face, Pali-always-shown), since a ResizeObserver on the container won't catch
  // that on its own.
  layoutKey?: string | number;
}

// RainDrop-style: a thin strip of colour marks along the edge of the scroll area, one per
// highlight, positioned at the same relative height its text sits at in the scrollable content
// — so a mark's position is where the scrollbar thumb would be if that highlight were on
// screen. Clicking one jumps straight to it.
export function HighlightGutter({ scrollRef, highlightGroups, onJump, layoutKey }: HighlightGutterProps) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [track, setTrack] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || highlightGroups.length === 0) {
      setMarks([]);
      setTrack(null);
      return;
    }

    function recompute() {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scrollHeight = container.scrollHeight;
      setTrack({ top: rect.top, height: rect.height });
      setMarks(
        highlightGroups.map((g) => {
          const el = container.querySelector<HTMLElement>(`[data-seg="${g.i}"]`);
          // Distance from the top of the scrollable content, independent of current scroll
          // position (getBoundingClientRect().top moves as you scroll; adding scrollTop back
          // cancels that out) and of any non-positioned wrapper divs between here and there.
          const contentTop = el ? el.getBoundingClientRect().top - rect.top + container.scrollTop : 0;
          const ratio = scrollHeight > 0 ? Math.min(1, Math.max(0, contentTop / scrollHeight)) : 0;
          return { key: g.key, i: g.i, c: g.c, top: ratio * rect.height };
        })
      );
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
    <div className="fixed z-40" style={{ top: track.top, height: track.height, right: 4, width: 10, pointerEvents: 'none' }}>
      {marks.map((m) => (
        <button
          key={m.key}
          className="absolute rounded-full shadow-sm"
          style={{ background: m.c, width: 8, height: 14, top: m.top - 7, right: 0, pointerEvents: 'auto' }}
          title="Jump to highlight"
          onClick={() => onJump(m.i)}
        />
      ))}
    </div>
  );
}
