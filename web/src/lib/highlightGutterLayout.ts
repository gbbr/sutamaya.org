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

// Position math for HighlightGutter's raindrop marks, kept out of that component so the
// screen-coordinate/scroll-unit conversion is unit-testable without a DOM. getBoundingClientRect()
// reports post-`zoom` screen coordinates while scrollTop/scrollHeight are pre-zoom layout units, so
// the rect values have to be divided by `scale` before the two are mixed. `containerRect`/`segTop`
// are raw getBoundingClientRect() readings; `scrollHeight`/`scrollTop` are the container's own
// scroll properties.
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
