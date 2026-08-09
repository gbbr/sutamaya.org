import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReaderOrigin } from './useReaderOrigin';

vi.mock('@reach/router', () => ({ navigate: vi.fn() }));
import { navigate } from '@reach/router';

beforeEach(() => {
  // Node's own built-in `localStorage` global shadows jsdom's here in a way that leaves it
  // unusable (see the same workaround in context/LayoutContext.test.tsx) — stub a plain
  // in-memory one.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useReaderOrigin', () => {
  it('navigateToSutta persists the origin under the new sutta id and carries from/fromView', () => {
    const { result } = renderHook(() => useReaderOrigin({ from: '/browse/sn1', fromView: 'list' }));
    result.current.navigateToSutta('sn1.2');

    expect(navigate).toHaveBeenCalledWith('/read/sn1.2', { state: { from: '/browse/sn1', fromView: 'list' } });
    expect(JSON.parse(localStorage.getItem('sutamaya.readerOrigin')!)).toEqual({
      suttaId: 'sn1.2',
      from: '/browse/sn1',
      fromView: 'list',
    });
  });

  it('navigateToSutta does not persist anything when there is no origin to carry', () => {
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.navigateToSutta('sn1.2');

    expect(localStorage.getItem('sutamaya.readerOrigin')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/read/sn1.2', { state: { from: undefined, fromView: undefined } });
  });

  it('closeToOrigin prefers router state (from) when present', () => {
    const { result } = renderHook(() => useReaderOrigin({ from: '/browse/sn1', fromView: 'tree' }));
    result.current.closeToOrigin('sn1.1', '/fallback');

    expect(navigate).toHaveBeenCalledWith(
      '/browse/sn1',
      expect.objectContaining({ state: expect.objectContaining({ fromView: 'tree', restoreOrigin: true }) })
    );
  });

  it('closeToOrigin falls back to the persisted origin (scoped by suttaId) when router state is absent', () => {
    localStorage.setItem('sutamaya.readerOrigin', JSON.stringify({ suttaId: 'sn1.1', from: '/browse/sn1', fromView: 'list' }));
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.closeToOrigin('sn1.1', '/fallback');

    expect(navigate).toHaveBeenCalledWith(
      '/browse/sn1',
      expect.objectContaining({ state: expect.objectContaining({ fromView: 'list', restoreOrigin: true }) })
    );
  });

  it('closeToOrigin ignores a persisted origin scoped to a different sutta', () => {
    localStorage.setItem('sutamaya.readerOrigin', JSON.stringify({ suttaId: 'sn1.1', from: '/browse/sn1', fromView: 'list' }));
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.closeToOrigin('sn2.1', '/fallback');

    expect(navigate).toHaveBeenCalledWith('/fallback');
  });

  it('closeToOrigin falls back to fallbackPath when there is no origin at all', () => {
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.closeToOrigin('sn1.1', '/fallback');

    expect(navigate).toHaveBeenCalledWith('/fallback');
  });
});
