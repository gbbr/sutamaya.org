import { useCallback, useEffect, useState } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useLatest } from './useLatest';
import { spansOverlap, type HlSpan } from '../lib/highlights';
import type { Highlight } from '../lib/types';

export interface PopState {
  span: HlSpan;
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
// either end outside the rendered segments, or offsets that resolve to an empty span.
function popFromSelection(sel: Selection, highlights: Highlight[]): PopState | null {
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
    const span = { i0: i, o0: st, i1: i, o1: en };
    const cur = highlights.find((h) => spansOverlap(h, span));
    return { span, x: anchorX, top: box.top, bottom: box.bottom, on: cur ? cur.c : null };
  }

  // Cross-segment selection. A Range's start and end are in document order whichever way the drag
  // went, so `a` is at or before `b` — the two ends are the span, and every segment between them is
  // covered by definition. Their positions among the rendered paragraphs are checked rather than
  // trusted: a selection reaching outside [data-segroot] isn't one this reader can act on.
  const root = a.closest('[data-segroot]');
  if (!root) return null;
  const allSegs = [...root.querySelectorAll<HTMLElement>('[data-seg]')];
  const startIdx = allSegs.indexOf(a);
  const endIdx = allSegs.indexOf(b);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  const span = {
    i0: Number(a.dataset.seg),
    o0: offsetWithin(a, range.startContainer, range.startOffset),
    i1: Number(b.dataset.seg),
    o1: offsetWithin(b, range.endContainer, range.endOffset),
  };

  // A fresh multi-segment selection is always a new highlight, never an edit of an existing one
  // (unlike the single-segment case, which can land inside one) — the color swatches just start
  // unselected.
  return { span, x: anchorX, top: box.top, bottom: box.bottom, on: null };
}

export function useHighlightPopup(suttaId: string | undefined, highlights: Highlight[]) {
  const { setHighlightSpan } = useUserData();
  const [pop, setPop] = useState<PopState | null>(null);

  // Stepping to another sutta leaves the popup anchored to text no longer on screen, and its span
  // indexes into the sutta it was opened in, so picking a colour would write it into the new one.
  useEffect(() => {
    setPop(null);
  }, [suttaId]);

  // Clicking directly on an already-highlighted span, rather than dragging a fresh selection, acts
  // on that whole highlight — the click hands back its id, so clicking one segment of a highlight
  // spanning several, or the visible half of a partly-covered one, still recolours or erases all
  // of it.
  const openPop = useCallback(
    (highlightId: string, rect: DOMRect, on: string | null) => {
      const hit = highlights.find((h) => h.id === highlightId);
      if (!hit) return;
      const { i0, o0, i1, o1 } = hit;
      setPop({ span: { i0, o0, i1, o1 }, x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, on });
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
      const next = popFromSelection(sel, highlights);
      if (next) setPop(next);
    }, 0);
  }, [highlights]);

  // Firefox on Android draws its selection handles as browser chrome: dragging one to extend the
  // selection fires no pointer, touch or mouse event on the page, only `selectionchange`. Without
  // this the popup keeps the range `onTextUp` opened it with — the single word the long-press
  // caught — and picking a colour highlights just that word.
  //
  // Deliberately only refreshes a popup that is already open, and only while no pointer is down:
  // Chrome and Safari go on committing at `mouseup`/`touchend` exactly as before, a fresh drag
  // can't make the popup appear before the pointer lifts, and a keyboard selection can't open one
  // at all.
  const latest = useLatest({ highlights, open: pop !== null });
  useEffect(() => {
    let down = false;
    const refresh = () => {
      const { highlights: hl, open } = latest.current;
      if (!open || down) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !String(sel).trim()) return;
      const next = popFromSelection(sel, hl);
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
      await setHighlightSpan(suttaId, pop.span, color);
      setPop(null);
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    },
    [pop, suttaId, setHighlightSpan]
  );

  const close = useCallback(() => {
    setPop(null);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }, []);
  const popStop = useCallback((e: { stopPropagation: () => void }) => e.stopPropagation(), []);

  return { pop, openPop, onTextUp, pick, close, popStop };
}
