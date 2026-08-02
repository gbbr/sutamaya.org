import { useCallback, useState } from 'react';
import { useUserData } from '../context/UserDataContext';
import type { Highlight } from '../lib/types';

export interface PopState {
  i: number;
  s: number;
  e: number;
  x: number;
  y: number;
  on: string | null;
}

function closestSeg(node: Node | null): HTMLElement | null {
  const el = node && node.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
  return el ? el.closest<HTMLElement>('[data-seg]') : null;
}

export function useHighlightPopup(suttaId: string | undefined, highlights: Highlight[]) {
  const { setHighlightRange } = useUserData();
  const [pop, setPop] = useState<PopState | null>(null);

  const openPop = useCallback((i: number, s: number, e: number, rect: DOMRect, on: string | null) => {
    setPop({ i, s, e, x: rect.left + rect.width / 2, y: rect.top, on });
  }, []);

  const onTextUp = useCallback(() => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !String(sel).trim()) {
        setPop((p) => (p && !p.on ? null : p));
        return;
      }
      const range = sel.getRangeAt(0);
      const a = closestSeg(range.startContainer);
      const b = closestSeg(range.endContainer);
      if (!a || a !== b) return;
      const pre = document.createRange();
      pre.selectNodeContents(a);
      pre.setEnd(range.startContainer, range.startOffset);
      const st = pre.toString().length;
      const en = st + String(sel).length;
      if (en <= st) return;
      const rect = range.getBoundingClientRect();
      const i = Number(a.dataset.seg);
      const cur = highlights.filter((h) => h.i === i).find((h) => h.s < en && h.e > st);
      setPop({ i, s: st, e: en, x: rect.left + rect.width / 2, y: rect.top, on: cur ? cur.c : null });
    }, 0);
  }, [highlights]);

  const pick = useCallback(
    async (color: string | null) => {
      if (!pop || !suttaId) return;
      await setHighlightRange(suttaId, pop.i, pop.s, pop.e, color);
      setPop(null);
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    },
    [pop, suttaId, setHighlightRange]
  );

  const close = useCallback(() => setPop(null), []);
  const popStop = useCallback((e: { stopPropagation: () => void }) => e.stopPropagation(), []);

  return { pop, openPop, onTextUp, pick, close, popStop };
}
