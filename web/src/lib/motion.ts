// The reader's own motion: the OS-level preference, and the entrance a sutta makes when the
// reader steps to it.

// Read per call rather than cached, so a preference changed mid-session takes effect at the next
// animation instead of at the next reload. Same reasoning as uiPrefs.ts's systemPrefersDark.
export function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// How far the text travels, and for how long. Reduced motion drops the travel and keeps the
// duration: it also keeps the step visible — one that can't be seen happen is the problem this
// animation exists to solve — and a fade is the only cue those readers get, so it is the last
// thing to shorten.
const STEP_TRAVEL_PX = 26;
const STEP_MS = 220;

// Ends any step animation still applying to `el`, so a step taken while the previous one is still
// running replaces it rather than compositing on top of it. Safe to call when nothing is running.
export function cancelStepAnimations(el: HTMLElement) {
  if (typeof el.getAnimations !== 'function') return;
  // Only animations on this element are returned, never its children's.
  for (const running of el.getAnimations()) running.cancel();
}

// Brings a sutta in from the edge the reader is travelling from — `dir` is +1 for a step to the
// next sutta, -1 for the previous — so the step reads as movement through the canon rather than
// the screen silently becoming a different sutta.
//
// Only the arriving sutta is animated. Carrying the outgoing one off as well would read more
// clearly still, but it means holding the faded-out text in place across the navigation and
// releasing it again on arrival, which is a lot of sequencing to get wrong for the difference it
// makes. Nothing here fills beyond its own run, so nothing can be left applying to the pane.
//
// Returns null where the platform has no Web Animations API, which the caller can ignore: there
// is nothing to wait for either way.
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
    // `backwards` so the opening keyframe applies from the moment the animation is created rather
    // than from its first frame — the caller starts this in a layout effect, and without the fill
    // the paint that follows can catch the new sutta fully opaque and un-offset.
    { duration: STEP_MS, easing: reduced ? 'ease' : 'cubic-bezier(.22,.61,.36,1)', fill: 'backwards' }
  );
}
