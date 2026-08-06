import { useCallback, useState } from 'react';
import { useUserData } from '../context/UserDataContext';
import { groupHighlights } from '../lib/highlights';
import type { SegmentFile } from '../lib/corpus';
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

export function useHighlightPopup(suttaId: string | undefined, highlights: Highlight[], segments: SegmentFile[] | null = null) {
  const { setHighlightRanges } = useUserData();
  const [pop, setPop] = useState<PopState | null>(null);

  // Clicking directly on an already-highlighted span (as opposed to dragging a fresh selection)
  // means "act on this highlight" — for a cross-segment one, that has to be every segment it
  // spans, not just the one clicked, or "remove"/recolor would only touch that one piece and
  // leave the rest behind as a separate, now-shorter highlight.
  const openPop = useCallback(
    (i: number, s: number, e: number, rect: DOMRect, on: string | null) => {
      const group = groupHighlights(highlights, segments).find((g) => g.items.some((h) => h.i === i && h.s === s && h.e === e));
      const ranges: HlRange[] = group ? group.items.map((h) => ({ i: h.i, s: h.s, e: h.e })) : [{ i, s, e }];
      setPop({ ranges, x: rect.left + rect.width / 2, y: rect.bottom, on });
    },
    [highlights, segments]
  );

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
      // Anchor at the end of the selection, not its horizontal center — the tail of the last
      // visual line (getClientRects()' last entry covers wrapped multi-line selections too, not
      // just the bounding box getBoundingClientRect() would give), so the colour picker lands
      // right where the user's cursor/finger lifted off and appears below that line, since above
      // is where the OS selection menu already sits on mobile.
      const rects = range.getClientRects();
      const endRect = rects[rects.length - 1] || range.getBoundingClientRect();

      if (a === b) {
        const st = offsetWithin(a, range.startContainer, range.startOffset);
        const en = st + String(sel).length;
        if (en <= st) return;
        const i = Number(a.dataset.seg);
        const cur = highlights.filter((h) => h.i === i).find((h) => h.s < en && h.e > st);
        setPop({ ranges: [{ i, s: st, e: en }], x: endRect.right, y: endRect.bottom, on: cur ? cur.c : null });
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
          // The segment's *data* length, not its rendered DOM textContent length — the `<p
          // data-seg>` can contain extra rendered characters beyond seg.en itself (e.g. the
          // translator-note asterisk, see SegmentedText), which would otherwise inflate a
          // middle/first segment's stored `e` past the real text length. That mismatch breaks
          // groupHighlights' boundary check (`prev.e === segments[prev.i].en.length`), so the
          // run never merges past that segment — clicking a highlight to remove it then only
          // finds part of the group, leaving the rest stranded. Falls back to textContent only
          // if segment data isn't available to this hook.
          const fullLen = segments?.[i]?.en.length ?? seg.textContent?.length ?? 0;
          const s = idx === 0 ? aStart : 0;
          const e = idx === between.length - 1 ? bEnd : fullLen;
          return { i, s, e };
        })
        .filter((r) => r.e > r.s);
      if (!ranges.length) return;

      // A fresh multi-segment selection is always a new highlight, never an edit of an
      // existing one (unlike the single-segment case, which can land inside one) — the color
      // swatches just start unselected.
      setPop({ ranges, x: endRect.right, y: endRect.bottom, on: null });
    }, 0);
  }, [highlights, segments]);

  const pick = useCallback(
    async (color: string | null) => {
      if (!pop || !suttaId) return;
      try {
        await setHighlightRanges(suttaId, pop.ranges, color);
      } catch (e) {
        console.error('highlight range save failed', e);
      }
      setPop(null);
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    },
    [pop, suttaId, setHighlightRanges]
  );

  const close = useCallback(() => setPop(null), []);
  const popStop = useCallback((e: { stopPropagation: () => void }) => e.stopPropagation(), []);

  return { pop, openPop, onTextUp, pick, close, popStop };
}
