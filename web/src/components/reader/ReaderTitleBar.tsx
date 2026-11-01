import { useEffect, useState, type RefObject } from 'react';
import { ArrowUpToLine } from 'lucide-react';
import { animateScrollTop, isAppScroll } from '../../lib/reader/segmentScroll';
import type { ThemeColors } from '../../lib/types';

// Distance the reader's own scroll runs one way before the bar follows it.
const TRAVEL = 10;

interface ReaderTitleBarProps {
  // The reading pane the bar watches and returns to the top.
  scrollRef: RefObject<HTMLElement>;
  // The sutta's own title, the bar's stand-in once it scrolls away.
  headingRef: RefObject<HTMLElement>;
  title: string;
  // The bar's top edge: under the Reader's header rule, which covers it, so no seam can open
  // between the two where the safe area and UI scale put the rule on a fraction of a pixel.
  top: string;
  theme: ThemeColors;
}

/**
 * ReaderTitleBar is the slim bar under the Reader's header on a phone, naming the sutta and
 * scrolling back to its top when tapped. It slides out from under the header on the reader's own
 * scroll up, and back under it on a scroll down, on a scroll the Reader makes itself, and once the
 * sutta's heading is in view.
 */
export function ReaderTitleBar({ scrollRef, headingRef, title, top, theme }: ReaderTitleBarProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const pane = scrollRef.current;
    const heading = headingRef.current;
    if (!pane || !heading) return;

    // Whether the sutta's heading is in view, where the bar never shows.
    let headingInView = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        headingInView = entry.isIntersecting;
        if (headingInView) setShown(false);
      },
      { root: pane }
    );
    observer.observe(heading);

    // The pane's offset, held inside its scroll range so the bounce at either end is no movement.
    const offset = () => Math.min(Math.max(pane.scrollTop, 0), Math.max(pane.scrollHeight - pane.clientHeight, 0));
    let last = offset();
    // How far the reader's scroll has run in its current direction, negative going up.
    let run = 0;

    const onScroll = () => {
      const at = offset();
      const moved = at - last;
      last = at;
      if (!moved) return;
      // A scroll the Reader makes itself: a jump, a glide, a return to a place.
      if (isAppScroll(pane)) {
        run = 0;
        setShown(false);
        return;
      }
      run = Math.sign(moved) === Math.sign(run) ? run + moved : moved;
      if (run >= TRAVEL) setShown(false);
      else if (run <= -TRAVEL && !headingInView) setShown(true);
    };

    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      pane.removeEventListener('scroll', onScroll);
    };
  }, [scrollRef, headingRef]);

  return (
    // The clip the bar slides up out of, under the header's rule, with room below for its shadow.
    <div className="absolute overflow-hidden pointer-events-none pb-6" style={{ top, left: 'var(--safe-left)', right: 'var(--safe-right)' }}>
      <button
        data-component="ReaderTitleBar"
        className="pointer-events-auto flex w-full h-9 items-center gap-4 px-5 backdrop-blur-xl backdrop-saturate-150 transition-[transform,visibility] duration-300 ease-out motion-reduce:transition-none"
        style={{
          // The theme's tint over the page colour, translucent over a blur of the text beneath, as an
          // iOS bar is.
          background: `linear-gradient(${theme.tint}, ${theme.tint}), color-mix(in srgb, ${theme.bg} 75%, transparent)`,
          // The header's rule along its foot, setting it off from the text in every theme.
          borderBottom: `1px solid ${theme.rule}`,
          boxShadow: '0 6px 16px rgba(0,0,0,.1)',
          transform: shown ? undefined : 'translateY(-100%)',
          visibility: shown ? undefined : 'hidden',
        }}
        aria-label="Scroll to top"
        onClick={() => scrollRef.current && animateScrollTop(scrollRef.current, 0)}
      >
        <span className="flex-1 min-w-0 truncate text-left font-serif text-ui-sm">{title}</span>
        <span className="flex flex-none items-center gap-1 font-sans text-ui-2xs font-bold tracking-[.12em] uppercase">
          <ArrowUpToLine size={14} strokeWidth={2} />
          Top
        </span>
      </button>
    </div>
  );
}
