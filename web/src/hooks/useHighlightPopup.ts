import { useCallback, useEffect, useState } from 'react';
import { useUserData } from '../context/UserDataContext';
import { groupHighlights, buildCrossSegmentRanges, type HlRange } from '../lib/highlights';
import type { SegmentFile } from '../lib/corpus';
import type { Highlight } from '../lib/types';

export type { HlRange };

export interface PopState {
  ranges: HlRange[];
  x: number;
  // The selection's vertical extent in screen space. The popup sits above `top` and, when there
  // isn't room for it up there, below `bottom` — so either way it clears the selected text.
  top: number;
  bottom: number;
  on: string | null;
}

// Whether the drag ran right-to-left / bottom-to-top: the focus is where the pointer lifted, the
// anchor where it went down, so a focus that precedes the anchor in the document means backwards.
function isBackwards(sel: Selection): boolean {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
  if (!anchorNode || !focusNode) return false;
  if (anchorNode === focusNode) return focusOffset < anchorOffset;
  return (anchorNode.compareDocumentPosition(focusNode) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

function closestSeg(node: Node | null): HTMLElement | null {
  const el = node && node.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
  return el ? el.closest<HTMLElement>('[data-seg]') : null;
}

// Text rendered inside a segment that isn't part of its stored `en` string — the list-item's
// "1." marker and the translator-note asterisk (see SegmentedText, which marks both). Both are
// `user-select: none`, but that only governs what the *user* can select: `Range.toString()`
// counts them regardless, so they have to be discounted by hand or every offset taken inside a
// numbered-list segment lands a couple of characters right of the selection.
const IGNORED_TEXT = '[data-seg-ignore]';

// How much of `pre`'s text belongs to those non-content elements. Both ranges start at the same
// point, so an element whose end yields a shorter-or-equal string ends at or before `pre`'s own
// end — meaning its text was counted and has to come back off.
function ignoredLengthWithin(seg: HTMLElement, pre: Range): number {
  const preLength = pre.toString().length;
  let ignored = 0;
  for (const el of seg.querySelectorAll<HTMLElement>(IGNORED_TEXT)) {
    const upTo = document.createRange();
    upTo.selectNodeContents(seg);
    upTo.setEndAfter(el);
    if (upTo.toString().length <= preLength) ignored += el.textContent?.length ?? 0;
  }
  return ignored;
}

// Character offset into `seg`'s stored text for a point inside its rendered DOM — used for both
// ends of a selection, single- or multi-segment, so they are always consistent with each other
// and with how highlighted spans are rendered (SegmentedText slices `seg.en` by these same
// offsets).
function offsetWithin(seg: HTMLElement, container: Node, containerOffset: number): number {
  const pre = document.createRange();
  pre.selectNodeContents(seg);
  pre.setEnd(container, containerOffset);
  return pre.toString().length - ignoredLengthWithin(seg, pre);
}

export function useHighlightPopup(suttaId: string | undefined, highlights: Highlight[], segments: SegmentFile[] | null = null) {
  const { setHighlightRanges } = useUserData();
  const [pop, setPop] = useState<PopState | null>(null);

  // Stepping to another sutta — by swipe, Prev/Next, keyboard or breadcrumb — leaves the popup
  // anchored to text that is no longer on screen, and its ranges index into the sutta it was
  // opened in, so picking a colour would write them into the new one.
  useEffect(() => {
    setPop(null);
  }, [suttaId]);

  // Clicking directly on an already-highlighted span (as opposed to dragging a fresh selection)
  // means "act on this highlight" — for a cross-segment one, that has to be every segment it
  // spans, not just the one clicked, or "remove"/recolor would only touch that one piece and
  // leave the rest behind as a separate, now-shorter highlight.
  const openPop = useCallback(
    (i: number, s: number, e: number, rect: DOMRect, on: string | null) => {
      const group = groupHighlights(highlights).find((g) => g.items.some((h) => h.i === i && h.s === s && h.e === e));
      const ranges: HlRange[] = group ? group.items.map((h) => ({ i: h.i, s: h.s, e: h.e })) : [{ i, s, e }];
      setPop({ ranges, x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, on });
    },
    [highlights]
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
      // Anchor horizontally where the drag ended, not at the selection's center — its
      // getClientRects() entries cover wrapped multi-line selections line by line, where the
      // single bounding box getBoundingClientRect() gives wouldn't. A Range's start/end are in
      // document order whichever way the user dragged, so which end the cursor lifted at comes
      // from the Selection's focus instead: dragging backwards lands it on the first line's left
      // edge. Vertically it's the selection's whole extent, so a popup placed above or below it
      // never covers a line the user just selected. Only the desktop popup uses this; on mobile
      // HighlightPopup pins itself to the bottom edge and ignores the anchor.
      const rects = range.getClientRects();
      const box = range.getBoundingClientRect();
      const back = isBackwards(sel);
      const focusRect = (back ? rects[0] : rects[rects.length - 1]) || box;
      const anchorX = back ? focusRect.left : focusRect.right;

      if (a === b) {
        const st = offsetWithin(a, range.startContainer, range.startOffset);
        // Measured the same way as the start rather than from the selection's own string length:
        // whether a `user-select: none` run inside the paragraph lands in `String(sel)` varies by
        // browser, where offsetWithin discounts it explicitly.
        const en = offsetWithin(a, range.endContainer, range.endOffset);
        if (en <= st) return;
        const i = Number(a.dataset.seg);
        const cur = highlights.filter((h) => h.i === i).find((h) => h.s < en && h.e > st);
        setPop({ ranges: [{ i, s: st, e: en }], x: anchorX, top: box.top, bottom: box.bottom, on: cur ? cur.c : null });
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

      // The segment's *data* length, not its rendered DOM textContent length — the `<p
      // data-seg>` can contain extra rendered characters beyond seg.en itself (e.g. the
      // translator-note asterisk, see SegmentedText), which would otherwise inflate a
      // middle/first segment's stored `e` past the end of the very text those offsets index
      // into. Falls back to textContent only if segment data isn't available to this hook.
      const segLengths = between.map((seg) => {
        const i = Number(seg.dataset.seg);
        return { i, fullLen: segments?.[i]?.en.length ?? seg.textContent?.length ?? 0 };
      });
      const ranges = buildCrossSegmentRanges(segLengths, aStart, bEnd);
      if (!ranges.length) return;

      // A fresh multi-segment selection is always a new highlight, never an edit of an
      // existing one (unlike the single-segment case, which can land inside one) — the color
      // swatches just start unselected.
      setPop({ ranges, x: anchorX, top: box.top, bottom: box.bottom, on: null });
    }, 0);
  }, [highlights, segments]);

  const pick = useCallback(
    async (color: string | null) => {
      if (!pop || !suttaId) return;
      // Writes to the offline mirror, so it can't fail on the network — the flush owns everything
      // that can (see UserDataContext).
      await setHighlightRanges(suttaId, pop.ranges, color);
      setPop(null);
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    },
    [pop, suttaId, setHighlightRanges]
  );

  const close = useCallback(() => {
    setPop(null);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }, []);
  const popStop = useCallback((e: { stopPropagation: () => void }) => e.stopPropagation(), []);

  return { pop, openPop, onTextUp, pick, close, popStop };
}
