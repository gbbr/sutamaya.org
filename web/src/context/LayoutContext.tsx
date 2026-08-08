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
  twoPane: boolean;
  desktop: boolean;
  paneW: PaneWidths;
  resetTree: () => void;
  dragTree: (e: ReactPointerEvent) => void;
}

const DEFAULTS: LayoutPrefs = { treeW: 264 };

// Also read by lib/uiPrefs.ts (mobile gets a baked-in UI scale boost) — kept as one exported
// constant rather than two literals so the two can't drift apart.
export const MOBILE_BREAKPOINT = 860;

const LayoutContext = createContext<LayoutState | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<LayoutPrefs>(LAYOUT_PREFS_KEY, DEFAULTS);
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  const drag = useRef<{ key: 'treeW'; x0: number; w0: number; min: number; max: number } | null>(null);

  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const next = Math.min(d.max, Math.max(d.min, d.w0 + e.clientX - d.x0));
      setPrefs((p) => ({ ...p, [d.key]: next }));
    };
    const onUp = () => {
      drag.current = null;
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
  const twoPane = w >= MOBILE_BREAKPOINT && w < 880;
  const desktop = w >= 880;

  const paneW = useMemo<PaneWidths>(() => {
    const treeMax = Math.max(210, w - 320);
    const tree = Math.min(prefs.treeW, treeMax);
    return { tree, treeMax };
  }, [w, prefs]);

  const value = useMemo<LayoutState>(
    () => ({
      ...prefs,
      w,
      mobile,
      twoPane,
      desktop,
      paneW,
      resetTree: () => setPrefs((p) => ({ ...p, treeW: 264 })),
      dragTree: (e) => {
        drag.current = { key: 'treeW', x0: e.clientX, w0: paneW.tree, min: 210, max: paneW.treeMax };
        document.body.style.userSelect = 'none';
      },
    }),
    [prefs, w, mobile, twoPane, desktop, paneW, setPrefs]
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
