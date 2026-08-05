import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: ReactNode;
  // e.g. the sign-in badge already prompts a full flow on click — no point tooltipping a
  // control that's conditionally not rendered/needed, but callers can also just omit Tooltip
  // entirely; this exists for the rare case a label is computed and can come out empty.
  disabled?: boolean;
}

// A small, deliberately-styled tooltip — the native `title` attribute renders as an OS chrome
// element (delay, styling, position) that varies per browser/platform and can't be styled to
// match the app. Portaled to <body> and positioned from the trigger's own getBoundingClientRect
// (not CSS position:absolute against a wrapper) so it always renders above every pane's own
// `overflow` clipping instead of getting cut off inside a scrolling tree/list row.
export function Tooltip({ label, children, disabled }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function open() {
    if (disabled || !label) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const el = wrapRef.current?.firstElementChild;
      if (el) setRect(el.getBoundingClientRect());
      setShow(true);
    }, 350);
  }

  function close() {
    clearTimer();
    setShow(false);
  }

  useEffect(() => clearTimer, []);

  return (
    // `contents` keeps this span out of the flex/grid layout entirely — only its child
    // participates — while still giving us a DOM node to hang hover/focus listeners on.
    <span ref={wrapRef} className="contents" onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close} onPointerDown={close}>
      {children}
      {show &&
        rect &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-[999] pointer-events-none font-sans text-[11.5px] font-medium px-[8px] py-[4px] rounded-md whitespace-nowrap animate-fadeIn"
            style={{
              background: '#1B1917',
              color: '#FBFAF7',
              boxShadow: '0 3px 10px rgba(27,25,23,.28)',
              left: Math.min(Math.max(rect.left + rect.width / 2, 8), window.innerWidth - 8),
              top: Math.max(rect.top - 8, 4),
              transform: 'translate(-50%, -100%)',
            }}
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  );
}
