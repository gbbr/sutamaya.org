import type { HighlightGroup } from './highlights';

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

// Pure position math for HighlightGutter's raindrop marks, kept out of that component so the
// screen-coordinate/scroll-unit conversion is unit-testable without a DOM. That conversion is the
// delicate part (see HighlightGutter's own comment): getBoundingClientRect() reports real,
// post-`zoom` screen coordinates, while scrollTop/scrollHeight are local, pre-zoom layout units,
// so the rect values have to be divided by `scale` before the two are mixed or every mark lands
// in the wrong place under a non-1 UI scale. `containerRect`/`segTop` are raw
// getBoundingClientRect() readings (post-zoom); `scrollHeight`/`scrollTop` are the container's
// own pre-zoom scroll properties.
export function computeGutterLayout(
  groups: HighlightGroup[],
  containerRect: { top: number; height: number },
  scrollHeight: number,
  scrollTop: number,
  scale: number,
  segTop: (segIndex: number) => number | undefined
): { track: GutterTrack; marks: GutterMark[] } {
  const top = containerRect.top / scale;
  const height = containerRect.height / scale;
  const track: GutterTrack = { top, height };
  const marks: GutterMark[] = groups.map((g) => {
    const rawTop = segTop(g.i);
    // Distance from the top of the scrollable content, independent of current scroll position
    // (a raw top reading moves as you scroll; adding scrollTop back cancels that out) and of any
    // non-positioned wrapper elements between the container and the segment.
    const contentTop = rawTop !== undefined ? rawTop / scale - top + scrollTop : 0;
    const ratio = scrollHeight > 0 ? Math.min(1, Math.max(0, contentTop / scrollHeight)) : 0;
    return { key: g.key, i: g.i, c: g.c, top: ratio * height };
  });
  return { track, marks };
}
