import { useEffect, useState, type RefObject } from 'react';
import type { HighlightGroup } from '../lib/highlights';
import { getUiScale } from '../lib/uiPrefs';

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
      // getBoundingClientRect() reports real, post-`zoom` screen coordinates, but scrollTop/
      // scrollHeight are local (pre-zoom) layout units — same distinction index.css's 100dvh
      // compensation deals with (see applyUiScale). Converting the rect values to local units
      // right away keeps everything below in one consistent frame, and means `track`/`marks`
      // are already the right numbers to assign directly as this component's own CSS lengths
      // (which get magnified by `zoom` back up to the real values at paint time).
      const scale = getUiScale();
      const rect = container.getBoundingClientRect();
      const top = rect.top / scale;
      const height = rect.height / scale;
      const scrollHeight = container.scrollHeight;
      setTrack({ top, height });
      setMarks(
        highlightGroups.map((g) => {
          const el = container.querySelector<HTMLElement>(`[data-seg="${g.i}"]`);
          // Distance from the top of the scrollable content, independent of current scroll
          // position (getBoundingClientRect().top moves as you scroll; adding scrollTop back
          // cancels that out) and of any non-positioned wrapper divs between here and there.
          const contentTop = el ? el.getBoundingClientRect().top / scale - top + container.scrollTop : 0;
          const ratio = scrollHeight > 0 ? Math.min(1, Math.max(0, contentTop / scrollHeight)) : 0;
          return { key: g.key, i: g.i, c: g.c, top: ratio * height };
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
    <div
      data-component="HighlightGutter"
      className="fixed z-40"
      style={{ top: track.top, height: track.height, right: 4, width: 24, pointerEvents: 'none' }}
    >
      {marks.map((m) => (
        <button
          key={m.key}
          className="absolute w-[11px] hover:w-[20px] rounded-[2px] shadow-sm transition-[width] duration-150 ease-out"
          style={{ background: m.c, height: 6, top: m.top - 3, right: 0, pointerEvents: 'auto' }}
          title="Jump to highlight"
          onClick={() => onJump(m.i)}
        />
      ))}
    </div>
  );
}
