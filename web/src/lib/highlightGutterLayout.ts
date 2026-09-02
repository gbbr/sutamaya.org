import type { Highlight } from './types';

export interface GutterTrack {
  top: number;
  height: number;
}

export interface GutterMark {
  key: string;
  i: number;
  c: string;
  top: number;
}

// Where HighlightGutter draws its track and marks. Kept out of the component so the conversion is
// testable without a DOM: `containerRect` and `segTop` are raw getBoundingClientRect() readings,
// which report post-`zoom` screen coordinates, so they are divided by `scale` before being mixed
// with the container's own pre-zoom `scrollHeight` and `scrollTop`.
export function computeGutterLayout(
  highlights: Highlight[],
  containerRect: { top: number; height: number },
  scrollHeight: number,
  scrollTop: number,
  scale: number,
  segTop: (segIndex: number) => number | undefined
): { track: GutterTrack; marks: GutterMark[] } {
  const top = containerRect.top / scale;
  const height = containerRect.height / scale;
  const track: GutterTrack = { top, height };
  // Positioned by the segment the highlight starts in, which is where a jump from the gutter lands.
  const marks: GutterMark[] = highlights.map((h) => {
    const rawTop = segTop(h.i0);
    // Distance from the top of the scrollable content: adding scrollTop back cancels out the way a
    // raw top reading moves as the container scrolls.
    const contentTop = rawTop !== undefined ? rawTop / scale - top + scrollTop : 0;
    const ratio = scrollHeight > 0 ? Math.min(1, Math.max(0, contentTop / scrollHeight)) : 0;
    return { key: h.id, i: h.i0, c: h.c, top: ratio * height };
  });
  return { track, marks };
}
