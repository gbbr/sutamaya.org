import { useCallback, useEffect, useState } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useLatest } from './useLatest';
import { spansOverlap, type HlSpan } from '../lib/highlights';
import type { Highlight } from '../lib/types';

// The colour popup over a selection or an existing highlight.
//
// A selection's two ends are resolved to character offsets into the segments' stored `en` text —
// the same coordinates highlights are stored and painted in — by measuring a Range against each
// segment and discounting the rendered text that isn't part of `en` (IGNORED_TEXT below). A
// cross-segment selection keeps only its two endpoints, everything between being covered by
// definition. Picking a colour writes through UserDataContext to the offline mirror.
export interface PopState {
  span: HlSpan;
  x: number;
  // The selection's vertical extent, which the popup sits above or below.
  top: number;
  bottom: number;
  on: string | null;
}

// True when the drag ran backwards: the focus is where the pointer lifted and the anchor where it
// went down, so a focus preceding the anchor in the document means right-to-left or bottom-to-top.
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

// Selector for text rendered inside a segment that isn't part of its stored `en`: the list-item
// marker and the note asterisk, which `Range.toString()` counts regardless of `user-select`.
const IGNORED_TEXT = '[data-seg-ignore]';

// Returns how much of `pre`'s text belongs to those elements. Both ranges start at the same point,
// so an element whose end yields no longer a string ends within `pre` and was counted.
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

// Returns the character offset into `seg`'s stored text for a point in its rendered DOM.
function offsetWithin(seg: HTMLElement, container: Node, containerOffset: number): number {
  const pre = document.createRange();
  pre.selectNodeContents(seg);
  pre.setEnd(container, containerOffset);
  return pre.toString().length - ignoredLengthWithin(seg, pre);
}

// Returns the popup state for a live selection, or null when it isn't one the reader can act on:
// an end outside the rendered segments, or offsets resolving to an empty span.
function popFromSelection(sel: Selection, highlights: Highlight[]): PopState | null {
  const range = sel.getRangeAt(0);
  const a = closestSeg(range.startContainer);
  const b = closestSeg(range.endContainer);
  if (!a || !b) return null;
  // Anchored horizontally where the drag ended, taken from the Selection's focus and the matching
  // client rect, so a wrapped selection anchors on the line the pointer lifted on. Vertically it
  // is the whole extent, so a popup above or below never covers a selected line. Desktop only;
  // HighlightPopup pins itself to the bottom edge on mobile.
  const rects = range.getClientRects();
  const box = range.getBoundingClientRect();
  const back = isBackwards(sel);
  const focusRect = (back ? rects[0] : rects[rects.length - 1]) || box;
  const anchorX = back ? focusRect.left : focusRect.right;

  if (a === b) {
    const st = offsetWithin(a, range.startContainer, range.startOffset);
    // Measured as the start is, rather than from the selection's string length: whether a
    // `user-select: none` run lands in `String(sel)` varies by browser.
    const en = offsetWithin(a, range.endContainer, range.endOffset);
    if (en <= st) return null;
    const i = Number(a.dataset.seg);
    const span = { i0: i, o0: st, i1: i, o1: en };
    const cur = highlights.find((h) => spansOverlap(h, span));
    return { span, x: anchorX, top: box.top, bottom: box.bottom, on: cur ? cur.c : null };
  }

  // A cross-segment selection. A Range's ends are in document order whichever way the drag went,
  // so `a` is at or before `b`; both are checked to be rendered paragraphs of this sutta.
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

  // Always a new highlight, never an edit of an existing one as the single-segment case can be, so
  // the swatches start unselected.
  return { span, x: anchorX, top: box.top, bottom: box.bottom, on: null };
}

export function useHighlightPopup(suttaId: string | undefined, highlights: Highlight[]) {
  const { setHighlightSpan } = useUserData();
  const [pop, setPop] = useState<PopState | null>(null);

  // Closes the popup on a sutta change: its span indexes into the sutta it was opened in.
  useEffect(() => {
    setPop(null);
  }, [suttaId]);

  // Opens the popup on an existing highlight, given its id, so a click anywhere in one recolours
  // or erases the whole of it — including a highlight spanning several segments.
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

  // Follows a selection extended by Firefox on Android's own handles, which fire nothing but
  // `selectionchange`. Only refreshes an open popup, and only while no pointer is down, so every
  // other browser goes on committing at `mouseup`/`touchend`.
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
      // Writes to the offline mirror, so it can't fail on the network.
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
