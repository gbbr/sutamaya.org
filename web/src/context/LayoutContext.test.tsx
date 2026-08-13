import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutProvider, useLayout } from './LayoutContext';
import { LAYOUT_PREFS_KEY } from '../lib/storageKeys';

// Dragging the tree-pane divider used to call setPrefs (and so localStorage.setItem) on every
// pointermove tick — a synchronous storage write, and a context-value recompute for every
// consumer, on every one of them. Only the *commit* on pointerup should touch storage; the live
// visual tracking during the drag itself should still update every tick (see paneW.tree below).
describe('LayoutContext drag-resize', () => {
  let setItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Node's own built-in `localStorage` global shadows jsdom's here in a way that leaves it
    // unusable (see the same workaround in pages/mobileSearchReaderFlow.test.tsx) — stub a plain
    // in-memory one, with `setItem` as its own spy so writes can be counted directly.
    const store = new Map<string, string>();
    setItem = vi.fn((k: string, v: string) => void store.set(k, String(v)));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem,
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  function renderLayout() {
    return renderHook(() => useLayout(), { wrapper: LayoutProvider });
  }

  it('commits treeW to storage once on pointerup, not on every pointermove', () => {
    const { result } = renderLayout();

    act(() => {
      result.current.dragTree({ clientX: 100, preventDefault: () => {} } as unknown as React.PointerEvent);
    });
    setItem.mockClear(); // dragTree itself doesn't persist — only isolate what follows

    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 190 }));
    });
    expect(setItem).not.toHaveBeenCalledWith(LAYOUT_PREFS_KEY, expect.anything());

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    const layoutWrites = setItem.mock.calls.filter(([key]) => key === LAYOUT_PREFS_KEY);
    expect(layoutWrites).toHaveLength(1);
    expect(JSON.parse(layoutWrites[0][1] as string)).toMatchObject({ treeW: 190 - 100 + 264 });
  });

  it('still tracks the live width on every pointermove for a smooth visual drag', () => {
    const { result } = renderLayout();
    const startTree = result.current.paneW.tree;

    act(() => {
      result.current.dragTree({ clientX: 100, preventDefault: () => {} } as unknown as React.PointerEvent);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140 }));
    });
    expect(result.current.paneW.tree).toBe(startTree + 40);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    // Committed value matches where the drag ended, not reset back to the start.
    expect(result.current.paneW.tree).toBe(startTree + 40);
  });
});
