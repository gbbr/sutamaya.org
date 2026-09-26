import { MOBILE_BREAKPOINT } from './layout';

// The app's motion: the OS-level preference, the transitions between screens, and the entrance a
// sutta makes when the reader steps to it.

// The OS's reduced-motion preference, read per call so a change mid-session takes effect at the
// next animation.
export function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How one screen gives way to another: `fade` into and out of the Reader, `push` onto a phone's
 * screen stack — a sutta list over the tree, Help and Settings over either — and `pop` back.
 * index.css draws each, keyed on the root's `data-page-transition`.
 */
export type PageTransition = 'fade' | 'push' | 'pop';

// The transition started last. Starting one skips any still running, whose end then comes after
// the newer one has named its own kind.
let latestPageTransition = 0;

/**
 * Runs `update`, which swaps one screen for another, as a view transition of the given kind. The
 * browser captures the new screen once `update` returns, or once its promise settles, so the swap
 * must be in the DOM by then — flushed, not merely scheduled. Where there are no view transitions
 * (iOS before 18) the update runs at once and the change is instant.
 *
 * A `push` or `pop` crossfades on a wide layout, having no stack to move in. A screen that only
 * fills a phone's window, the sutta list over the tree, has no transition there at all and is its
 * caller's own decision (LibraryPage).
 *
 * Started from the app's own controls rather than through React Router's `viewTransition` option,
 * which replays a transition on the browser's Back and Forward too — over the animation Safari's
 * swipe back already plays.
 */
export function transitionPage(kind: PageTransition, update: () => unknown): void {
  if (typeof document.startViewTransition !== 'function') {
    void update();
    return;
  }
  const root = document.documentElement;
  const id = ++latestPageTransition;
  // Only the phone layout is a stack; a wider one has its panes side by side, with nothing for an
  // arriving screen to slide over.
  root.dataset.pageTransition = window.innerWidth < MOBILE_BREAKPOINT ? kind : 'fade';
  const settle = () => {
    if (id === latestPageTransition) delete root.dataset.pageTransition;
  };
  document.startViewTransition(update).finished.then(settle, settle);
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
