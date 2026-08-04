import { useCallback, useState } from 'react';
import { useUserData } from '../context/UserDataContext';
import type { Highlight } from '../lib/types';

export interface HlRange {
  i: number;
  s: number;
  e: number;
}

export interface PopState {
  ranges: HlRange[];
  x: number;
  y: number;
  on: string | null;
}

function closestSeg(node: Node | null): HTMLElement | null {
  const el = node && node.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
  return el ? el.closest<HTMLElement>('[data-seg]') : null;
}

// Character offset from the start of `seg`'s text to a point inside it — same technique for
// both ends of a selection, single- or multi-segment, so they're always consistent with each
// other and with how highlighted spans are rendered (SegmentedText slices `seg.en` by these
// same offsets).
function offsetWithin(seg: HTMLElement, container: Node, containerOffset: number): number {
  const pre = document.createRange();
  pre.selectNodeContents(seg);
  pre.setEnd(container, containerOffset);
  return pre.toString().length;
}

export function useHighlightPopup(suttaId: string | undefined, highlights: Highlight[]) {
  const { setHighlightRange } = useUserData();
  const [pop, setPop] = useState<PopState | null>(null);

  const openPop = useCallback((i: number, s: number, e: number, rect: DOMRect, on: string | null) => {
    setPop({ ranges: [{ i, s, e }], x: rect.left + rect.width / 2, y: rect.top, on });
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
      if (!a || !b) return;
      const rect = range.getBoundingClientRect();

      if (a === b) {
        const st = offsetWithin(a, range.startContainer, range.startOffset);
        const en = st + String(sel).length;
        if (en <= st) return;
        const i = Number(a.dataset.seg);
        const cur = highlights.filter((h) => h.i === i).find((h) => h.s < en && h.e > st);
        setPop({ ranges: [{ i, s: st, e: en }], x: rect.left + rect.width / 2, y: rect.top, on: cur ? cur.c : null });
        return;
      }

      // Cross-segment selection: a Range's start/end are always in document order regardless
      // of which way the user dragged, so `a` is guaranteed at or before `b` here — walk every
      // [data-seg] paragraph between them (the root's whole set, since segments are the only
      // elements carrying that attribute) and build one range per segment: the tail of `a`
      // (selection start to end-of-segment), each segment strictly in between in full, and the
      // head of `b` (start-of-segment to selection end).
      const root = a.closest('[data-segroot]');
      if (!root) return;
      const allSegs = [...root.querySelectorAll<HTMLElement>('[data-seg]')];
      const startIdx = allSegs.indexOf(a);
      const endIdx = allSegs.indexOf(b);
      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;
      const between = allSegs.slice(startIdx, endIdx + 1);
      const aStart = offsetWithin(a, range.startContainer, range.startOffset);
      const bEnd = offsetWithin(b, range.endContainer, range.endOffset);

      const ranges: HlRange[] = between
        .map((seg, idx) => {
          const i = Number(seg.dataset.seg);
          const fullLen = seg.textContent?.length ?? 0;
          const s = idx === 0 ? aStart : 0;
          const e = idx === between.length - 1 ? bEnd : fullLen;
          return { i, s, e };
        })
        .filter((r) => r.e > r.s);
      if (!ranges.length) return;

      // A fresh multi-segment selection is always a new highlight, never an edit of an
      // existing one (unlike the single-segment case, which can land inside one) — the color
      // swatches just start unselected.
      setPop({ ranges, x: rect.left + rect.width / 2, y: rect.top, on: null });
    }, 0);
  }, [highlights]);

  const pick = useCallback(
    async (color: string | null) => {
      if (!pop || !suttaId) return;
      // Sequential, not Promise.all: setHighlightRange does an optimistic read-modify-write of
      // local highlight state plus a full server refetch per call, so overlapping calls for
      // the same suttaId (different segments of the same selection) could race and clobber
      // each other's optimistic update. Awaiting them one at a time keeps every call working
      // off the previous one's already-settled state.
      for (const r of pop.ranges) {
        await setHighlightRange(suttaId, r.i, r.s, r.e, color);
      }
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
