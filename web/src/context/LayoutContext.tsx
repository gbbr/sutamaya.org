import { createContext, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';

interface LayoutPrefs {
  treeW: number;
  listW: number;
  treeHidden: boolean;
  previewHidden: boolean;
}

interface PaneWidths {
  tree: number;
  list: number;
  treeMax: number;
  listMax: number;
}

interface LayoutState extends LayoutPrefs {
  w: number;
  mobile: boolean;
  twoPane: boolean;
  desktop: boolean;
  paneW: PaneWidths;
  hideTree: () => void;
  showTree: () => void;
  hidePreview: () => void;
  showPreview: () => void;
  resetTree: () => void;
  resetList: () => void;
  dragTree: (e: ReactPointerEvent) => void;
  dragList: (e: ReactPointerEvent) => void;
}

const DEFAULTS: LayoutPrefs = { treeW: 264, listW: 404, treeHidden: false, previewHidden: false };

const LayoutContext = createContext<LayoutState | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<LayoutPrefs>('sutamaya.layout', DEFAULTS);
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  const drag = useRef<{ key: 'treeW' | 'listW'; x0: number; w0: number; min: number; max: number } | null>(null);

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

  const mobile = w < 860;
  const twoPane = w >= 860 && w < 880;
  const desktop = w >= 880;

  const paneW = useMemo<PaneWidths>(() => {
    const three = desktop && !prefs.previewHidden;
    const treeMax = Math.max(210, three ? w - 280 - 330 : w - 320);
    const tree = prefs.treeHidden ? 0 : Math.min(prefs.treeW, treeMax);
    const listMax = three ? Math.max(280, w - tree - 330) : w;
    const list = Math.max(280, Math.min(prefs.listW, listMax));
    return { tree, list, treeMax, listMax };
  }, [w, desktop, prefs]);

  const value = useMemo<LayoutState>(
    () => ({
      ...prefs,
      w,
      mobile,
      twoPane,
      desktop,
      paneW,
      hideTree: () => setPrefs((p) => ({ ...p, treeHidden: true })),
      showTree: () => setPrefs((p) => ({ ...p, treeHidden: false })),
      hidePreview: () => setPrefs((p) => ({ ...p, previewHidden: true })),
      showPreview: () => setPrefs((p) => ({ ...p, previewHidden: false })),
      resetTree: () => setPrefs((p) => ({ ...p, treeW: 264 })),
      resetList: () => setPrefs((p) => ({ ...p, listW: 404 })),
      dragTree: (e) => {
        drag.current = { key: 'treeW', x0: e.clientX, w0: paneW.tree, min: 210, max: paneW.treeMax };
        document.body.style.userSelect = 'none';
      },
      dragList: (e) => {
        drag.current = { key: 'listW', x0: e.clientX, w0: paneW.list, min: 280, max: paneW.listMax };
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
