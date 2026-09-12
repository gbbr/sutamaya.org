import { prefersReducedMotion } from './motion';
import type { ThemeColors } from './types';

// The reading visibly going down into the put-aside bar.
//
// Setting a sutta aside and closing it both leave the reader for the Library, so without this the
// only thing telling them apart is a bar quietly gaining a tab at the far edge of a screen the
// reader has just arrived on. This is what makes the connection rather than announcing it: the page
// they were on shrinks into the bar, so where it went is watched rather than deduced.
//
// It plays *after* the route change, over the Library, which is what stops it reading as a page
// collapsing into nothing. What shrinks is a card painted in the reader's own paper, not a clone of
// the reading — at this speed the eye reads the block of paper and its title, and cloning a few
// thousand segment nodes to scale them costs a great deal for something on screen for a quarter of
// a second.
//
// It lives outside React, on `document.body`: it has to outlive the page that starts it, and it is
// a fire-and-forget visual with nothing for a component to own. Inert throughout — no pointer
// events, no focus, no layout of its own — so an interrupted one leaves nothing behind but a node
// that removes itself.

// Material's container transform, which is the standard motion for one element becoming another:
// the box morphs to the target's own rect rather than shrinking uniformly to a small copy of
// itself, and the content inside it fades early so nothing is watched being squashed. The card
// arrives before it goes, rather than dissolving on the way.
//
// The spec's own figures for a full-screen container transform: 500ms on the Emphasized curve.
// Shorter reads as a flinch across this distance, and Emphasized is the curve for a transform in
// either direction — it leaves slowly, covers the ground, and settles long, where a decelerate
// curve throws the card off the mark and then crawls.
const DURATION_MS = 500;
const EASE = 'cubic-bezier(.2, 0, 0, 1)';
// The fraction of the run the title is gone by, and the fraction the box holds full opacity for.
const CONTENT_FADE = 0.3;
const HOLD_OPACITY = 0.8;
// How long a tuck is treated as under way, which is what keeps the bar from playing its own
// entrance underneath one — see `tuckJustStarted`.
const IN_FLIGHT_MS = DURATION_MS + 120;
// Long stop, in case the animation never resolves — a page hidden mid-flight, a browser that drops
// the frame callbacks. The card is inert, but it must not be left painted over the Library.
const SAFETY_MS = 2000;
// Frames to give the Library and its bar to lay out before the card is aimed. The bar renders in
// the same commit as the page, so it is there almost at once; this is slack for a slow one.
const AIM_FRAMES = 12;

// When the last tuck was raised.
let startedAt = 0;

/**
 * Whether a tuck is on screen, which the bar reads to skip its own slide-up.
 *
 * The card arriving *is* the bar appearing, and a bar sliding up beneath a card coming down is both
 * two animations competing and a target whose rect is moving while the card is aimed at it.
 */
export function tuckJustStarted(): boolean {
  return performance.now() - startedAt < IN_FLIGHT_MS;
}

/** Where the card is aiming: the tab it is becoming, or the bar it is joining. */
function targetRect(suttaId: string): DOMRect | null {
  const bar = document.querySelector('[data-component="PutAsideBar"]');
  if (!bar) return null;
  const tab = bar.querySelector(`[data-put-aside-tab="${CSS.escape(suttaId)}"]`);
  return (tab ?? bar).getBoundingClientRect();
}

/**
 * Plays the reading down into the bar, over whatever the reader navigated to.
 *
 * Call it immediately before navigating: the card is painted at the reader's full size first, so
 * the route change happens underneath something already covering the screen and never flashes.
 * Does nothing where the reader has asked for less motion — there the bar's own entrance and the
 * tab landing are the whole of the signal.
 */
export function tuckIntoBar({ suttaId, label, theme, face }: { suttaId: string; label: string; theme: ThemeColors; face: string }) {
  if (prefersReducedMotion() || typeof document === 'undefined') return;
  startedAt = performance.now();

  const card = document.createElement('div');
  card.setAttribute('aria-hidden', 'true');
  card.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:60',
    'pointer-events:none',
    'overflow:hidden',
    // The box is morphed by scaling each axis to the target's, so it has to grow from the corner
    // the target's own corner is measured from.
    'transform-origin:top left',
    `background:${theme.bg}`,
  ].join(';');

  // The header's own line, so the shrinking block reads as the page that was on screen rather than
  // as a plain rectangle.
  const title = document.createElement('div');
  title.textContent = label;
  title.style.cssText = [
    'padding:14px 20px',
    `border-bottom:1px solid ${theme.rule}`,
    `color:${theme.fg}`,
    `font-family:${face}`,
    'font-size:15px',
    'opacity:.75',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');
  card.appendChild(title);
  document.body.appendChild(card);

  const remove = () => card.remove();
  const safety = window.setTimeout(remove, SAFETY_MS);

  // Waits for the tab itself to be laid out before aiming. Firing on a fixed number of frames
  // means aiming at whatever is there by then — the bottom of the screen, or a bar mid-layout —
  // and landing beside the tab rather than on it.
  const aim = (framesLeft: number) => {
    const found = targetRect(suttaId);
    if (!found && framesLeft > 0) {
      requestAnimationFrame(() => aim(framesLeft - 1));
      return;
    }
    {
      const from = card.getBoundingClientRect();
      // No bar to land in — the set is somehow empty by now. Settle onto the foot of the screen,
      // which is where the bar would have been, rather than somewhere arbitrary.
      const to = found ?? new DOMRect(0, from.height - 44, from.width, 44);
      const dx = to.left - from.left;
      const dy = to.top - from.top;
      const sx = to.width / from.width;
      const sy = to.height / from.height;

      const done = () => {
        window.clearTimeout(safety);
        remove();
      };
      try {
        // The title goes first and quickly: text carried the whole way would be watched squashing
        // into the tab's height, and by a third of the way in there is nothing left to read.
        title.animate([{ opacity: 0.75 }, { opacity: 0, offset: CONTENT_FADE }, { opacity: 0 }], {
          duration: DURATION_MS,
          easing: 'linear',
          fill: 'forwards',
        });
        const anim = card.animate(
          [
            { transform: 'translate(0,0) scale(1,1)', opacity: 1 },
            { opacity: 1, offset: HOLD_OPACITY },
            { transform: `translate(${dx}px, ${dy}px) scale(${sx},${sy})`, opacity: 0 },
          ],
          { duration: DURATION_MS, easing: EASE, fill: 'forwards' }
        );
        anim.onfinish = done;
        anim.oncancel = done;
      } catch {
        // No Web Animations here — the card has already done its one job of covering the route
        // change, so take it away.
        done();
      }
    }
  };
  requestAnimationFrame(() => aim(AIM_FRAMES));
}
