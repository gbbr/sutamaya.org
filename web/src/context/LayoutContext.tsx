import { createContext, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { LAYOUT_PREFS_KEY } from '../lib/storageKeys';

interface LayoutPrefs {
  treeW: number;
}

interface PaneWidths {
  tree: number;
  treeMax: number;
}

interface LayoutState extends LayoutPrefs {
  w: number;
  mobile: boolean;
  paneW: PaneWidths;
  resetTree: () => void;
  dragTree: (e: ReactPointerEvent) => void;
}

const DEFAULTS: LayoutPrefs = { treeW: 264 };

// Also read by lib/uiPrefs.ts (mobile gets a baked-in UI scale boost) — kept as one exported
// constant rather than two literals so the two can't drift apart.
export const MOBILE_BREAKPOINT = 860;

const LayoutContext = createContext<LayoutState | null>(null);

// Eats the one synthetic compatibility click a touch device fires after the divider drag ends.
// That click hit-tests at the *lift-off* point rather than at the divider, and the divider stops
// tracking the finger once the drag clamps at its min/max — so an overshoot past either end lands
// the click on whichever tree or list row is under the finger, opening a sutta the user never
// tapped. Cancelling `pointerdown` (and `touchend`, on the divider itself) is supposed to suppress
// this, but WebKit in a standalone PWA honors neither reliably: touchstart arrives uncancelable
// there, and otherwise-identical gestures sometimes synthesize the click anyway. Swallowing it
// here is the part that doesn't depend on the browser cooperating.
//
// Disarmed by the next `pointerdown` as well as by the timeout, so a real tap — which always
// begins with one — can never be the click that gets eaten.
function swallowNextClick() {
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    disarm();
  };
  const disarm = () => {
    window.clearTimeout(timer);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('pointerdown', disarm, true);
  };
  const timer = window.setTimeout(disarm, 400);
  window.addEventListener('click', onClick, true);
  window.addEventListener('pointerdown', disarm, true);
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<LayoutPrefs>(LAYOUT_PREFS_KEY, DEFAULTS);
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  const drag = useRef<{ key: 'treeW'; x0: number; w0: number; min: number; max: number; moved: boolean } | null>(null);
  // Live width while actively dragging the tree-pane divider, kept out of `prefs` (and so out of
  // usePersistedState's un-debounced `localStorage.setItem`) until the drag actually ends —
  // committing on every `pointermove` tick meant a synchronous storage write on every one of
  // them, the one place in the app where persistence was wired to a high-frequency event. Ref
  // mirror so `onUp` (a stable closure registered once, below) always reads the latest value
  // rather than whatever `liveTreeW` was at effect-setup time.
  const [liveTreeW, setLiveTreeW] = useState<number | null>(null);
  const liveTreeWRef = useRef<number | null>(null);

  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.moved = true;
      const next = Math.min(d.max, Math.max(d.min, d.w0 + e.clientX - d.x0));
      liveTreeWRef.current = next;
      setLiveTreeW(next);
    };
    const onUp = () => {
      if (drag.current && liveTreeWRef.current != null) {
        const committed = liveTreeWRef.current;
        setPrefs((p) => ({ ...p, treeW: committed }));
      }
      // Only a drag that actually moved displaces what's under the finger — a bare tap on the
      // strip has nothing to swallow, and arming for it would eat a click the user does want.
      if (drag.current?.moved) swallowNextClick();
      drag.current = null;
      liveTreeWRef.current = null;
      setLiveTreeW(null);
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setPrefs]);

  const mobile = w < MOBILE_BREAKPOINT;

  const paneW = useMemo<PaneWidths>(() => {
    const treeMax = Math.max(210, w - 320);
    const tree = Math.min(liveTreeW ?? prefs.treeW, treeMax);
    return { tree, treeMax };
  }, [w, prefs, liveTreeW]);

  const value = useMemo<LayoutState>(
    () => ({
      ...prefs,
      w,
      mobile,
      paneW,
      resetTree: () => setPrefs((p) => ({ ...p, treeW: 264 })),
      dragTree: (e) => {
        // Asks the browser to suppress the compatibility mouse events a touch gesture would
        // otherwise synthesize, and stops a mouse drag from selecting text as it sweeps across
        // both panes. Browsers that honor it save `swallowNextClick` (above) the work; the ones
        // that don't are why that fallback exists.
        e.preventDefault();
        drag.current = { key: 'treeW', x0: e.clientX, w0: paneW.tree, min: 210, max: paneW.treeMax, moved: false };
        document.body.style.userSelect = 'none';
      },
    }),
    [prefs, w, mobile, paneW, setPrefs]
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
