import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReaderOrigin } from './useReaderOrigin';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

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
  it('turnToturns the page in place, persisting the origin under the new sutta id and carrying from/fromView', () => {
    const { result } = renderHook(() => useReaderOrigin({ from: '/browse/sn1', fromView: 'list' }));
    result.current.turnTo('sn1.2');

    expect(navigate).toHaveBeenCalledWith('/read/sn1.2', {
      state: { from: '/browse/sn1', fromView: 'list' },
      replace: true,
    });
    expect(JSON.parse(localStorage.getItem('sutamaya.readerOrigin')!)).toEqual({
      suttaId: 'sn1.2',
      from: '/browse/sn1',
      fromView: 'list',
    });
  });

  it('turnTodoes not persist anything when there is no origin to carry', () => {
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.turnTo('sn1.2');

    expect(localStorage.getItem('sutamaya.readerOrigin')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/read/sn1.2', {
      state: { from: undefined, fromView: undefined },
      replace: true,
    });
  });

  it('the first jump adds the one step back, which later moves keep, or take when they land there', () => {
    const initialProps: Parameters<typeof useReaderOrigin>[0] = { from: '/browse/sn1', searchIds: ['sn1.1', 'sn1.2'] };
    const { result, rerender } = renderHook((state) => useReaderOrigin(state), { initialProps });
    result.current.jumpTo('mn10', undefined, 'sn1.1');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn10', {
      state: { from: '/browse/sn1', backTo: 'sn1.1' },
      replace: false,
    });

    rerender({ from: '/browse/sn1', backTo: 'sn1.1' });
    result.current.turnTo('mn11');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn11', {
      state: { from: '/browse/sn1', backTo: 'sn1.1' },
      replace: true,
    });

    // A later jump takes the current sutta's place too, still returning to the first.
    result.current.jumpTo('an4.10', undefined, 'mn11');
    expect(navigate).toHaveBeenLastCalledWith('/read/an4.10', {
      state: { from: '/browse/sn1', backTo: 'sn1.1' },
      replace: true,
    });

    // A hit naming a passage in the first sutta opens it there, leaving no way back.
    const markedBy = { queries: ['sati'], anywhere: false };
    result.current.jumpTo('sn1.1', { segments: [3, 4], paliSegments: [4], markedBy }, 'an4.10');
    expect(navigate).toHaveBeenLastCalledWith('/read/sn1.1', {
      state: expect.objectContaining({ segments: [3, 4], paliSegments: [4], markedBy, backTo: undefined }),
      replace: true,
    });

    result.current.turnTo('sn1.1');
    expect(navigate).toHaveBeenLastCalledWith(-1);
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

    // Flushed, so the fade out of the Reader captures the Library already in place (lib/motion.ts).
    expect(navigate).toHaveBeenCalledWith('/fallback', { flushSync: true });
  });

  it('closeToOrigin falls back to fallbackPath when there is no origin at all', () => {
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.closeToOrigin('sn1.1', '/fallback');

    expect(navigate).toHaveBeenCalledWith('/fallback', { flushSync: true });
  });
});
