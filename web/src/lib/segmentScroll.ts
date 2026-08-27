import { prefersReducedMotion } from './motion';

// Position math for useSuttaReading's scrollToSegment. Settings > UI scale is applied via CSS
// `zoom` on <html> (lib/uiPrefs.ts), so getBoundingClientRect() reports post-zoom screen
// coordinates while scrollBy's `top` is a pre-zoom scroll unit — dividing by `scale` converts the
// former into the latter. `containerRect`/`elRect` are raw getBoundingClientRect() readings.
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

// iOS Safari with CSS `zoom` active applies an extra, undocumented zoom division to the pixel
// argument of an animated `scrollBy`/`scrollTo`, on top of the one applied above — landing short of
// the target by a factor of `scale`, worse the farther the jump. `scrollTop` is a plain property
// write with no such ambiguity, so the animation is driven by hand rather than through the
// browser's own "smooth" interpolation.
const activeScrollAnimations = new WeakMap<HTMLElement, () => void>();

// Cancel-on-user-input, which native smooth scrolling gives for free: a touch or wheel started
// mid-jump would otherwise be overwritten by the next animation frame.
const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

export function animateScrollTop(container: HTMLElement, targetScrollTop: number, duration = 350) {
  activeScrollAnimations.get(container)?.();
  const start = container.scrollTop;
  const delta = targetScrollTop - start;
  if (delta === 0) return;

  // Honour the OS motion preference by hand, since this bypasses `behavior:'smooth'`, which does
  // it natively.
  if (prefersReducedMotion()) {
    container.scrollTop = targetScrollTop;
    return;
  }

  // `startTime` is seeded from the first rAF callback's own timestamp rather than a
  // `performance.now()` read taken before scheduling: jsdom's rAF clock runs independently of
  // `performance.now()`, which sends `t` negative on the opening frames. Deriving both readings
  // from the same clock keeps `t` in [0,1] on every engine.
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
