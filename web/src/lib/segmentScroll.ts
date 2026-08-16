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
  const START_MARGIN = 14;
  return block === 'center'
    ? (elRect.top + elRect.height / 2 - (containerRect.top + containerRect.height / 2)) / scale
    : (elRect.top - containerRect.top) / scale - START_MARGIN;
}

// Real-device iOS Safari (with CSS `zoom` active — see uiPrefs.ts's supportsZoom) applies an
// *extra*, undocumented zoom division to the pixel argument of an animated
// `scrollBy({behavior:'smooth'})`/`scrollTo({behavior:'smooth'})` call on top of the one already
// applied above to convert the getBoundingClientRect (post-zoom) measurement into scrollTop's own
// (pre-zoom) units — landing short of the target by a factor of `scale`, worse the farther the
// jump. `scrollTop` itself has no such ambiguity (a plain property read/write, not an
// animated-scroll API), so this drives the animation by hand instead of trusting the browser's
// own "smooth" interpolation to use the same units on every engine.
const activeScrollAnimations = new WeakMap<HTMLElement, () => void>();

// Cancel-on-user-input, same as native smooth scrolling would give us for free: without this, a
// touch/wheel that starts mid-jump would otherwise get overwritten by the next animation frame,
// fighting the very scroll the user is trying to do.
const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

export function animateScrollTop(container: HTMLElement, targetScrollTop: number, duration = 350) {
  activeScrollAnimations.get(container)?.();
  const start = container.scrollTop;
  const delta = targetScrollTop - start;
  if (delta === 0) return;

  // Same reasoning as uiPrefs.ts's systemPrefersDark: honor the OS-level motion preference
  // rather than always animating, since this bypasses the browser's own `behavior:'smooth'`
  // (which handles that natively) in favor of a hand-rolled rAF loop.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    container.scrollTop = targetScrollTop;
    return;
  }

  // `startTime` is seeded from the first rAF callback's own timestamp, not a `performance.now()`
  // read taken here before scheduling it — jsdom's rAF clock runs independently of (and can lag
  // well behind) `performance.now()`, so seeding from the latter made `t` go deeply negative on
  // the opening frames under test, driving easeOutCubic far outside [0,1] and overshooting the
  // target by a large, non-deterministic margin before self-correcting. Deriving both readings
  // from the same rAF clock keeps `t` in [0,1] on every engine.
  let startTime: number | null = null;
  let cancelled = false;
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  function cancel() {
    cancelled = true;
    CANCEL_EVENTS.forEach((type) => container.removeEventListener(type, cancel));
    activeScrollAnimations.delete(container);
  }
  function step(now: number) {
    if (cancelled) return;
    if (startTime === null) startTime = now;
    const t = Math.min(1, (now - startTime) / duration);
    container.scrollTop = start + delta * easeOutCubic(t);
    if (t < 1) requestAnimationFrame(step);
    else cancel();
  }
  activeScrollAnimations.set(container, cancel);
  CANCEL_EVENTS.forEach((type) => container.addEventListener(type, cancel, { passive: true, once: true }));
  requestAnimationFrame(step);
}
