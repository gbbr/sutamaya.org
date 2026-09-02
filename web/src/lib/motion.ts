// The reader's own motion: the OS-level preference, and the entrance a sutta makes when the
// reader steps to it.

// The OS's reduced-motion preference, read per call so a change mid-session takes effect at the
// next animation.
export function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// How far the arriving text travels; reduced motion drops it, leaving the fade as the only cue.
const STEP_TRAVEL_PX = 26;
// How long the entrance takes, reduced motion included.
const STEP_MS = 220;

// Ends any step animation still applying to `el`, so a step taken during one replaces it rather
// than compositing over it. Safe to call when nothing is running.
export function cancelStepAnimations(el: HTMLElement) {
  if (typeof el.getAnimations !== 'function') return;
  // Only this element's own animations are returned, never its children's.
  for (const running of el.getAnimations()) running.cancel();
}

// Brings a sutta in from the edge the reader is travelling from, `dir` being +1 for a step to the
// next sutta and -1 for the previous. Returns null where there is no Web Animations API, which the
// caller can ignore.
export function animateStep(el: HTMLElement, dir: 1 | -1): Animation | null {
  if (typeof el.animate !== 'function') return null;
  const reduced = prefersReducedMotion();
  return el.animate(
    reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `translateX(${dir * STEP_TRAVEL_PX}px)` },
          { opacity: 1, transform: 'none' },
        ],
    // `backwards`, so the opening keyframe applies from creation rather than from the first frame,
    // which the paint after the caller's layout effect would otherwise get ahead of.
    { duration: STEP_MS, easing: reduced ? 'ease' : 'cubic-bezier(.22,.61,.36,1)', fill: 'backwards' }
  );
}
