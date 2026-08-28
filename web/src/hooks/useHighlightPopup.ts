import { useCallback, useEffect, useState } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useLatest } from './useLatest';
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

// Text rendered inside a segment that isn't part of its stored `en` string: the list-item's "1."
// marker and the translator-note asterisk, both marked by SegmentedText. They carry
// `user-select: none`, but that governs only what the user can select — `Range.toString()` counts
// them regardless, so they are discounted by hand.
const IGNORED_TEXT = '[data-seg-ignore]';

// How much of `pre`'s text belongs to those non-content elements. Both ranges start at the same
// point, so an element whose end yields a shorter or equal string ends at or before `pre`'s end,
// meaning its text was counted and has to come back off.
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

// The popup for a live, non-collapsed selection, or null when it isn't one the reader can act on:
// either end outside the rendered segments, or offsets that resolve to an empty range.
function popFromSelection(sel: Selection, highlights: Highlight[], segments: SegmentFile[] | null): PopState | null {
  const range = sel.getRangeAt(0);
  const a = closestSeg(range.startContainer);
  const b = closestSeg(range.endContainer);
  if (!a || !b) return null;
  // Anchored horizontally where the drag ended rather than at the selection's centre:
  // getClientRects() covers a wrapped multi-line selection line by line, which the single
  // bounding box of getBoundingClientRect() doesn't. A Range's start and end are in document
  // order whichever way the drag went, so which end the cursor lifted at comes from the
  // Selection's focus — dragging backwards lands on the first line's left edge. Vertically it
  // is the selection's whole extent, so a popup above or below never covers a selected line.
  // Only the desktop popup uses this; on mobile HighlightPopup pins itself to the bottom edge.
  const rects = range.getClientRects();
  const box = range.getBoundingClientRect();
  const back = isBackwards(sel);
  const focusRect = (back ? rects[0] : rects[rects.length - 1]) || box;
  const anchorX = back ? focusRect.left : focusRect.right;

  if (a === b) {
    const st = offsetWithin(a, range.startContainer, range.startOffset);
    // Measured the same way as the start rather than from the selection's string length:
    // whether a `user-select: none` run lands in `String(sel)` varies by browser, where
    // offsetWithin discounts it explicitly.
    const en = offsetWithin(a, range.endContainer, range.endOffset);
    if (en <= st) return null;
    const i = Number(a.dataset.seg);
    const cur = highlights.filter((h) => h.i === i).find((h) => h.s < en && h.e > st);
    return { ranges: [{ i, s: st, e: en }], x: anchorX, top: box.top, bottom: box.bottom, on: cur ? cur.c : null };
  }

  // Cross-segment selection. A Range's start and end are in document order whichever way the
  // drag went, so `a` is at or before `b`: walk every [data-seg] paragraph between them and
  // build one range per segment — the tail of `a`, each segment in between in full, and the
  // head of `b`.
  const root = a.closest('[data-segroot]');
  if (!root) return null;
  const allSegs = [...root.querySelectorAll<HTMLElement>('[data-seg]')];
  const startIdx = allSegs.indexOf(a);
  const endIdx = allSegs.indexOf(b);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  const between = allSegs.slice(startIdx, endIdx + 1);
  const aStart = offsetWithin(a, range.startContainer, range.startOffset);
  const bEnd = offsetWithin(b, range.endContainer, range.endOffset);

  // The segment's data length, not its rendered textContent length: a `<p data-seg>` can hold
  // characters beyond seg.en — the translator-note asterisk — which would inflate a stored `e`
  // past the end of the text those offsets index into. Falls back to textContent only where
  // segment data isn't available to this hook.
  const segLengths = between.map((seg) => {
    const i = Number(seg.dataset.seg);
    return { i, fullLen: segments?.[i]?.en.length ?? seg.textContent?.length ?? 0 };
  });
  const ranges = buildCrossSegmentRanges(segLengths, aStart, bEnd);
  if (!ranges.length) return null;

  // A fresh multi-segment selection is always a new highlight, never an edit of an existing one
  // (unlike the single-segment case, which can land inside one) — the color swatches just start
  // unselected.
  return { ranges, x: anchorX, top: box.top, bottom: box.bottom, on: null };
}

export function useHighlightPopup(suttaId: string | undefined, highlights: Highlight[], segments: SegmentFile[] | null = null) {
  const { setHighlightRanges } = useUserData();
  const [pop, setPop] = useState<PopState | null>(null);

  // Stepping to another sutta leaves the popup anchored to text no longer on screen, and its ranges
  // index into the sutta it was opened in, so picking a colour would write them into the new one.
  useEffect(() => {
    setPop(null);
  }, [suttaId]);

  // Clicking directly on an already-highlighted span, rather than dragging a fresh selection, acts
  // on that highlight — and for a cross-segment one that means every segment it spans, or a remove
  // or recolour would leave the rest behind as a shorter highlight.
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
      const next = popFromSelection(sel, highlights, segments);
      if (next) setPop(next);
    }, 0);
  }, [highlights, segments]);

  // Firefox on Android draws its selection handles as browser chrome: dragging one to extend the
  // selection fires no pointer, touch or mouse event on the page, only `selectionchange`. Without
  // this the popup keeps the range `onTextUp` opened it with — the single word the long-press
  // caught — and picking a colour highlights just that word.
  //
  // Deliberately only refreshes a popup that is already open, and only while no pointer is down:
  // Chrome and Safari go on committing at `mouseup`/`touchend` exactly as before, a fresh drag
  // can't make the popup appear before the pointer lifts, and a keyboard selection can't open one
  // at all.
  const latest = useLatest({ highlights, segments, open: pop !== null });
  useEffect(() => {
    let down = false;
    const refresh = () => {
      const { highlights: hl, segments: segs, open } = latest.current;
      if (!open || down) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !String(sel).trim()) return;
      const next = popFromSelection(sel, hl, segs);
      if (next) setPop(next);
    };
    const onDown = () => {
      down = true;
    };
    const onUp = () => {
      down = false;
    };
    document.addEventListener('selectionchange', refresh);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      document.removeEventListener('selectionchange', refresh);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [latest]);

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
