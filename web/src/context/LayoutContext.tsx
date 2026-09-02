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

// The tree pane's width before the divider is dragged, and what "Reset" restores.
export const DEFAULT_TREE_W = 360;

const DEFAULTS: LayoutPrefs = { treeW: DEFAULT_TREE_W };

// Viewport width below which the app is in its mobile layout. Also read by lib/uiPrefs.ts.
export const MOBILE_BREAKPOINT = 860;

const LayoutContext = createContext<LayoutState | null>(null);

// Eats the compatibility click a touch device synthesizes after the divider drag ends, which would
// otherwise open whichever row the finger lifted over. Disarmed by the next `pointerdown` as well
// as by its timeout, so a real tap can never be the click that gets eaten.
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
  // Live width while the divider is being dragged, held out of `prefs` — and so out of
  // usePersistedState's storage write — until the drag ends. The ref mirror is what `onUp`, a
  // stable closure, reads.
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
      // Only a drag that moved displaces what is under the finger; a bare tap on the strip has no
      // click worth eating.
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
    const treeMax = Math.max(250, w - 380);
    const tree = Math.min(liveTreeW ?? prefs.treeW, treeMax);
    return { tree, treeMax };
  }, [w, prefs, liveTreeW]);

  const value = useMemo<LayoutState>(
    () => ({
      ...prefs,
      w,
      mobile,
      paneW,
      resetTree: () => setPrefs((p) => ({ ...p, treeW: DEFAULTS.treeW })),
      dragTree: (e) => {
        // Asks the browser to suppress the mouse events a touch gesture synthesizes, and stops a
        // mouse drag selecting text across both panes. `swallowNextClick` is the fallback.
        e.preventDefault();
        drag.current = { key: 'treeW', x0: e.clientX, w0: paneW.tree, min: 250, max: paneW.treeMax, moved: false };
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
