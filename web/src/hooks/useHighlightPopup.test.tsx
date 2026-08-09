import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHighlightPopup } from './useHighlightPopup';
import type { Highlight } from '../lib/types';
import type { SegmentFile } from '../lib/corpus';

vi.mock('../context/UserDataContext', () => ({ useUserData: vi.fn() }));
import { useUserData } from '../context/UserDataContext';

function mockUserData() {
  const setHighlightRanges = vi.fn(async () => {});
  vi.mocked(useUserData).mockReturnValue({ setHighlightRanges } as unknown as ReturnType<typeof useUserData>);
  return { setHighlightRanges };
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
    it('builds one range from the selection offsets within that segment', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', [], null));

      selectAcross(segs[0], 0, segs[0], 5); // "Hello"
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.ranges).toEqual([{ i: 0, s: 0, e: 5 }]);
      expect(result.current.pop?.on).toBeNull();
    });

    it('collapses to null when the selection is empty', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', [], null));

      selectAcross(segs[0], 3, segs[0], 3);
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop).toBeNull();
    });

    it('reports the existing highlight color when the selection lands inside one', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const highlights: Highlight[] = [{ id: 'h1', i: 0, s: 0, e: 5, c: 'yellow', g: 'g1' }];
      const { result } = renderHook(() => useHighlightPopup('sn1.1', highlights, null));

      selectAcross(segs[0], 1, segs[0], 4); // inside the existing [0,5) highlight
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.on).toBe('yellow');
    });
  });

  describe('cross-segment selection', () => {
    it('builds one range per segment: tail of the first, full middle segments, head of the last', async () => {
      mockUserData();
      // Segment 1's rendered DOM text is deliberately longer than its stored `en` text — this
      // mirrors the real mismatch that caused a past bug (translator-note asterisk rendered
      // inline but not part of `seg.en`, see this hook's own comment) — a middle segment's `e`
      // must come from the segment data, not DOM textContent.
      const { segs } = buildSegRoot(['Alpha text', 'Beta text*', 'Gamma text']);
      const segments: SegmentFile[] = [
        { key: 'sn1.1:1', pali: '', en: 'Alpha text' },
        { key: 'sn1.1:2', pali: '', en: 'Beta text' },
        { key: 'sn1.1:3', pali: '', en: 'Gamma text' },
      ];
      const { result } = renderHook(() => useHighlightPopup('sn1.1', [], segments));

      selectAcross(segs[0], 6, segs[2], 5); // "text" of seg0 through "Gamma" of seg2
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.ranges).toEqual([
        { i: 0, s: 6, e: 10 }, // "Alpha text".length === 10, not affected by the mismatch
        { i: 1, s: 0, e: 9 }, // segments[1].en.length (9), NOT seg.textContent.length (10)
        { i: 2, s: 0, e: 5 },
      ]);
    });

    it('falls back to DOM textContent length when no segments array is provided', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Alpha', 'Beta']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', [], null));

      selectAcross(segs[0], 2, segs[1], 2);
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.ranges).toEqual([
        { i: 0, s: 2, e: 5 }, // 'Alpha'.length
        { i: 1, s: 0, e: 2 },
      ]);
    });

    it('drops zero-length ranges produced by an edge-aligned selection', async () => {
      mockUserData();
      const { segs } = buildSegRoot(['Alpha', 'Beta']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', [], null));

      // Selection ends exactly at the start of the last segment, so that segment's range is empty.
      selectAcross(segs[0], 0, segs[1], 0);
      await triggerTextUp(result.current.onTextUp);

      expect(result.current.pop?.ranges).toEqual([{ i: 0, s: 0, e: 5 }]);
    });
  });

  describe('openPop', () => {
    it('expands a click on one piece of a cross-segment highlight to every piece in its group', () => {
      mockUserData();
      const highlights: Highlight[] = [
        { id: 'h1', i: 0, s: 5, e: 10, c: 'blue', g: 'group-1' },
        { id: 'h2', i: 1, s: 0, e: 3, c: 'blue', g: 'group-1' },
        { id: 'h3', i: 5, s: 0, e: 3, c: 'red', g: 'group-2' },
      ];
      const { result } = renderHook(() => useHighlightPopup('sn1.1', highlights, null));

      act(() => {
        result.current.openPop(0, 5, 10, new DOMRect(0, 0, 0, 0), 'blue');
      });

      expect(result.current.pop?.ranges).toEqual(
        expect.arrayContaining([
          { i: 0, s: 5, e: 10 },
          { i: 1, s: 0, e: 3 },
        ])
      );
      expect(result.current.pop?.ranges).toHaveLength(2);
    });
  });

  describe('pick', () => {
    it('saves the current ranges and clears the popup', async () => {
      const { setHighlightRanges } = mockUserData();
      const { segs } = buildSegRoot(['Hello world']);
      const { result } = renderHook(() => useHighlightPopup('sn1.1', [], null));

      selectAcross(segs[0], 0, segs[0], 5);
      await triggerTextUp(result.current.onTextUp);

      await act(async () => {
        await result.current.pick('yellow');
      });

      expect(setHighlightRanges).toHaveBeenCalledWith('sn1.1', [{ i: 0, s: 0, e: 5 }], 'yellow');
      expect(result.current.pop).toBeNull();
    });
  });
});
