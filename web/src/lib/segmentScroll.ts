// Pure position math for useSuttaReading's scrollToSegment, split out for the same reason
// highlightGutterLayout.ts's computeGutterLayout was: this app applies Settings > UI scale via
// CSS `zoom` on <html> (lib/uiPrefs.ts), and getBoundingClientRect() reports real, post-zoom
// screen coordinates while scrollBy's `top` is a local, pre-zoom scroll unit — dividing by
// `scale` converts the former into the latter before it's used as a scroll delta. `containerRect`/
// `elRect` are raw getBoundingClientRect() readings (post-zoom).
export function computeSegmentScrollOffset(
  containerRect: { top: number; height: number },
  elRect: { top: number; height: number },
  block: ScrollLogicalPosition,
  scale: number
): number {
  const START_MARGIN = 24;
  return block === 'center'
    ? (elRect.top + elRect.height / 2 - (containerRect.top + containerRect.height / 2)) / scale
    : (elRect.top - containerRect.top) / scale - START_MARGIN;
}
