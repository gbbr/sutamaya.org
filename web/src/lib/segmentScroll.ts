import { prefersReducedMotion } from './motion';

// Scrolling one element into view inside the reading pane, and the animation that gets there.
//
// Every offset here is in scroll units, not screen pixels: the UI scale is CSS `zoom`, which
// getBoundingClientRect() reports through and a scroll write doesn't, so a rect reading is divided
// by the scale before the two are mixed. iOS Safari compounds this by applying the same division
// again to an animated `scrollBy`, so the animation is driven by hand through `scrollTop` rather
// than through the browser's own smooth scrolling.

// How far to scroll to bring `elRect` to `block` within `containerRect`, both raw rect readings.
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

// Each container's running scroll animation, so a new one cancels it.
const activeScrollAnimations = new WeakMap<HTMLElement, () => void>();

// The inputs that cancel a running scroll, which native smooth scrolling gives for free.
const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

// Animates a container to an absolute scroll position, cancelling on any user input.
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

// Animates a container by a relative offset, in scroll units.
export function animateScrollBy(container: HTMLElement, offset: number) {
  animateScrollTop(container, container.scrollTop + offset);
}
