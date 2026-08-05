import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: ReactNode;
  // e.g. the sign-in badge already prompts a full flow on click — no point tooltipping a
  // control that's conditionally not rendered/needed, but callers can also just omit Tooltip
  // entirely; this exists for the rare case a label is computed and can come out empty.
  disabled?: boolean;
  // Which side of the trigger the tooltip opens on. 'top' (default) suits a small icon-only
  // button; 'left' is for a trigger up against the top edge of its pane, where a centered-above
  // tooltip would get clipped or read as floating in the wrong place — e.g. the Library/List
  // toggle pill and the "Preview" button.
  side?: 'top' | 'left';
}

const GAP = 8; // distance from the trigger's edge to the tooltip's own edge
const ARROW = 8; // the pointy bit's rendered size (it's a rotated square, so this is its side)

// A small, deliberately-styled tooltip — the native `title` attribute renders as an OS chrome
// element (inconsistent delay, styling, position across browsers/platforms) that can't be
// styled to match the app. Opens instantly (no hover delay), fixed to the trigger element's own
// `getBoundingClientRect()` — not the cursor, which reads as jittery/unstable since it shifts
// with every small mouse movement. Portaled to <body> so it always renders above every pane's
// own `overflow` clipping instead of getting cut off inside a scrolling tree/list row.
export function Tooltip({ label, children, disabled, side = 'top' }: TooltipProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  function open() {
    if (disabled || !label) return;
    const el = wrapRef.current?.firstElementChild;
    if (el) setRect(el.getBoundingClientRect());
  }

  function close() {
    setRect(null);
  }

  const boxStyle: React.CSSProperties =
    rect && side === 'left'
      ? { left: Math.max(rect.left - GAP, 8), top: Math.min(Math.max(rect.top + rect.height / 2, 8), window.innerHeight - 8), transform: 'translate(-100%, -50%)' }
      : rect
        ? { left: Math.min(Math.max(rect.left + rect.width / 2, 8), window.innerWidth - 8), top: Math.max(rect.top - GAP, 4), transform: 'translate(-50%, -100%)' }
        : {};

  const arrowStyle: React.CSSProperties =
    side === 'left'
      ? { right: -ARROW / 2, top: '50%', transform: 'translateY(-50%) rotate(45deg)' }
      : { left: '50%', bottom: -ARROW / 2, transform: 'translateX(-50%) rotate(45deg)' };

  return (
    // `contents` keeps this span out of the flex/grid layout entirely — only its child
    // participates — while still giving us a DOM node to hang hover/focus listeners on.
    <span ref={wrapRef} className="contents" onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close} onPointerDown={close}>
      {children}
      {rect &&
        createPortal(
          <div role="tooltip" className="fixed z-[999] pointer-events-none" style={boxStyle}>
            <div
              className="relative font-sans text-[11.5px] font-medium px-[8px] py-[4px] rounded-md whitespace-nowrap"
              style={{ background: '#1B1917', color: '#FBFAF7', boxShadow: '0 3px 10px rgba(27,25,23,.28)' }}
            >
              {label}
              <div className="absolute" style={{ width: ARROW, height: ARROW, background: '#1B1917', ...arrowStyle }} />
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
