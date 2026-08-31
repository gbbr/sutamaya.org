import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHighlightPopup } from './useHighlightPopup';
import type { Highlight } from '../lib/types';

vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
import { useUserData } from '../context/UserDataContext';

const MTIME = '2026-01-01T00:00:00.000Z|dev';

function mockUserData() {
  const setHighlightSpan = vi.fn(async () => {});
  vi.mocked(useUserData).mockReturnValue({ setHighlightSpan } as unknown as ReturnType<typeof useUserData>);
  return { setHighlightSpan };
}

// Builds a `[data-segroot]` containing one `[data-seg]` paragraph per string, attached to
// document.body — the Selection API only lets a Range reference nodes that are actually in the
// document.
function buildSegRoot(texts: string[]) {
  const root = document.createElement('div');
  root.setAttribute('data-segroot', '');
  const segs = texts.map((text, i) => {
    const p = document.createElement('p');
    p.dataset.seg = String(i);
    p.textContent = text;
    root.appendChild(p);
    return p;
  });
  document.body.appendChild(root);
  return { root, segs };
}

function selectAcross(startEl: HTMLElement, startOffset: number, endEl: HTMLElement, endOffset: number) {
  const range = document.createRange();
  range.setStart(startEl.firstChild as Node, startOffset);
  range.setEnd(endEl.firstChild as Node, endOffset);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// onTextUp defers its own logic by one tick (setTimeout(…, 0)) so the browser's own selection
// has settled — flush that tick under `act` so React sees the resulting setPop as one update.
async function triggerTextUp(onTextUp: () => void) {
  await act(async () => {
    onTextUp();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('useHighlightPopup', () => {
  describe('single-segment selection', () => {
    it('takes both ends of the span from the selection offsets within that segment', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', []));

      selectAcross(segs[0], 0, segs[0], 5); // "Hello"
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.span).toEqual({ i0: 0, o0: 0, i1: 0, o1: 5 });
      expect(result.current.pop?.on).toBeNull();
    });

    // A list-item segment renders its "1." marker, and any segment with a translator note renders
    // an asterisk, inside the same [data-seg] paragraph — neither is part of the stored `en` text,
    // and SegmentedText marks both `data-seg-ignore`. Range.toString() counts them regardless of
    // `user-select: none`, so without discounting them every offset taken in such a segment lands
    // a couple of characters right of what was selected.
    it('discounts rendered text that is not part of the segment', async () => {
      mockUserData();
      const root = document.createElement('div');
      root.setAttribute('data-segroot', '');
      const p = document.createElement('p');
      p.dataset.seg = '0';
      const marker = document.createElement('span');
      marker.setAttribute('data-seg-ignore', '');
      marker.textContent = '1.';
      const body = document.createTextNode('Hello world');
      const note = document.createElement('sup');
      note.setAttribute('data-seg-ignore', '');
      note.textContent = '*';
      p.append(marker, body, note);
      root.appendChild(p);
      document.body.appendChild(root);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', []));

      const range = document.createRange();
      range.setStart(body, 0);
      range.setEnd(body, 5); // "Hello"
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.span).toEqual({ i0: 0, o0: 0, i1: 0, o1: 5 });
    });

    it('collapses to null when the selection is empty', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', []));

      selectAcross(segs[0], 3, segs[0], 3);
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop).toBeNull();
    });

    it('reports the existing highlight color when the selection lands inside one', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const highlights: Highlight[] = [{ id: 'h1', i0: 0, o0: 0, i1: 0, o1: 5, c: 'yellow', m: MTIME }];
      const { result } = renderHook(() => useHighlightPopup('sn1.1', highlights));

      selectAcross(segs[0], 1, segs[0], 4); // inside the existing [0,5) highlight
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.on).toBe('yellow');
    });

    // Lands inside a highlight that starts in an earlier segment and ends in a later one, so the
    // overlap can only be seen by comparing (segment, offset) pairs.
    it('reports the colour of a cross-segment highlight the selection lands in the middle of', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Alpha', 'Beta', 'Gamma']);
      const highlights: Highlight[] = [{ id: 'h1', i0: 0, o0: 2, i1: 2, o1: 3, c: 'blue', m: MTIME }];
      const { result } = renderHook(() => useHighlightPopup('sn1.1', highlights));

      selectAcross(segs[1], 0, segs[1], 4);
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.on).toBe('blue');
    });
  });

  describe('cross-segment selection', () => {
    // Only the two ends are recorded — the segments between them are covered by definition, so
    // nothing here measures a middle segment. That is what makes a mismatch between a middle
    // segment's rendered DOM text and its stored `en` (the translator-note asterisk, say)
    // impossible to get wrong, and what leaves no stored length to go stale when the text changes.
    it('records the two ends and nothing about the segments between them', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Alpha text', 'Beta text*', 'Gamma text']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', []));

      selectAcross(segs[0], 6, segs[2], 5); // "text" of seg0 through "Gamma" of seg2
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.span).toEqual({ i0: 0, o0: 6, i1: 2, o1: 5 });
    });

    it('records an edge-aligned end as offset 0 of the segment the selection reached', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Alpha', 'Beta']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', []));

      selectAcross(segs[0], 0, segs[1], 0);
      await triggerTextUp(result.current.onTextUp);

      // Nothing of the second segment is covered — highlightRanges drops that empty tail when it
      // paints (see lib/highlights.ts).
      expect(result.current.pop?.span).toEqual({ i0: 0, o0: 0, i1: 1, o1: 0 });
    });
  });

  describe('openPop', () => {
    it('opens on the whole of a cross-segment highlight, from a click on any part of it', () => {
      mockUserData();
      const highlights: Highlight[] = [
        { id: 'group-1', i0: 0, o0: 5, i1: 1, o1: 3, c: 'blue', m: MTIME },
        { id: 'group-2', i0: 5, o0: 0, i1: 5, o1: 3, c: 'red', m: MTIME },
      ];
      const { result } = renderHook(() => useHighlightPopup('sn1.1', highlights));

      act(() => {
        result.current.openPop('group-1', new DOMRect(0, 0, 0, 0), 'blue');
      });

      expect(result.current.pop?.span).toEqual({ i0: 0, o0: 5, i1: 1, o1: 3 });
    });

    it('opens nothing for an id no longer among this sutta\'s highlights', () => {
      mockUserData();
      const { result } = renderHook(() => useHighlightPopup('sn1.1', []));

      act(() => {
        result.current.openPop('gone', new DOMRect(0, 0, 0, 0), 'blue');
      });

      expect(result.current.pop).toBeNull();
    });
  });

  describe('pick', () => {
    it('saves the current span and clears the popup', async () => {
      const { setHighlightSpan } = mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', []));

      selectAcross(segs[0], 0, segs[0], 5);
      await triggerTextUp(result.current.onTextUp);

      await act(async () => {
        await result.current.pick('yellow');
      });

      expect(setHighlightSpan).toHaveBeenCalledWith('sn1.1', { i0: 0, o0: 0, i1: 0, o1: 5 }, 'yellow');
      expect(result.current.pop).toBeNull();
    });
  });
});
