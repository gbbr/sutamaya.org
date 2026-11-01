import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReaderOrigin } from '../useReaderOrigin';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

beforeEach(() => {
  // Node's own built-in `localStorage` global shadows jsdom's here in a way that leaves it
  // unusable (see the same workaround in context/__tests__/LayoutContext.test.tsx) — stub a plain
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
  it('pushes one translation consultation, replaces alternatives, and returns to Sujato', () => {
    const initialProps: Parameters<typeof useReaderOrigin>[0] = {
      from: '/browse/mn?q=calm', fromView: 'list', searchIds: ['mn1', 'mn2'], backTo: 'dn1',
    };
    const { result, rerender } = renderHook((state) => useReaderOrigin(state), { initialProps });
    result.current.chooseTranslation('mn1', 'bodhi', 'sujato');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn1?by=bodhi', {
      replace: false,
      state: expect.objectContaining({
        from: initialProps.from, fromView: 'list', searchIds: ['mn1', 'mn2'],
        backTo: 'mn1', translationStep: true, sujatoHasWayBack: true,
      }),
    });
    rerender({ ...initialProps, backTo: 'mn1', translationStep: true, sujatoHasWayBack: true });
    result.current.chooseTranslation('mn1', 'thanissaro', 'bodhi');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn1?by=thanissaro', {
      replace: true,
      state: expect.objectContaining({ backTo: 'mn1', translationStep: true, sujatoHasWayBack: true, searchIds: ['mn1', 'mn2'] }),
    });
    result.current.chooseTranslation('mn1', 'sujato', 'thanissaro');
    expect(navigate).toHaveBeenLastCalledWith(-1);
  });

  it('replaces a directly addressed alternative without inventing a return entry', () => {
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.chooseTranslation('mn1', 'thanissaro', 'bodhi');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn1?by=thanissaro', {
      replace: true, state: expect.objectContaining({ backTo: undefined, translationStep: undefined }),
    });
    result.current.chooseTranslation('mn1', 'sujato', 'bodhi');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn1', {
      replace: true, state: expect.objectContaining({ backTo: undefined, translationStep: false }),
    });
  });

  it('a page turn drops the way back to Sujato, unless the Sujato entry has a way back of its own', () => {
    const initialProps: Parameters<typeof useReaderOrigin>[0] = { from: '/browse/mn' };
    const { result, rerender } = renderHook((state) => useReaderOrigin(state), { initialProps });
    result.current.chooseTranslation('mn1', 'bodhi', 'sujato');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn1?by=bodhi', {
      replace: false, state: expect.objectContaining({ backTo: 'mn1', translationStep: true, sujatoHasWayBack: false }),
    });
    rerender({ from: '/browse/mn', backTo: 'mn1', translationStep: true, sujatoHasWayBack: false });
    result.current.turnTo('mn2');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn2', { state: { from: '/browse/mn', backTo: undefined }, replace: true });

    // After a jump, the way back stays, leading through Sujato's text to where the jump left.
    rerender({ from: '/browse/mn', backTo: 'mn1', translationStep: true, sujatoHasWayBack: true });
    result.current.turnTo('mn2');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn2', { state: { from: '/browse/mn', backTo: 'mn1' }, replace: true });
  });

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

  it('each jump adds a step back to the sutta it left, which turning keeps and landing there takes', () => {
    const initialProps: Parameters<typeof useReaderOrigin>[0] = { from: '/browse/sn1', searchIds: ['sn1.1', 'sn1.2'] };
    const { result, rerender } = renderHook((state) => useReaderOrigin(state), { initialProps });
    result.current.jumpTo('mn10', undefined, 'sn1.1');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn10', {
      state: { from: '/browse/sn1', backTo: 'sn1.1', navId: expect.any(String) },
      replace: false,
    });

    rerender({ from: '/browse/sn1', backTo: 'sn1.1' });
    result.current.turnTo('mn11');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn11', {
      state: { from: '/browse/sn1', backTo: 'sn1.1' },
      replace: true,
    });

    // A later jump adds a step of its own, back to the sutta it left.
    result.current.jumpTo('an4.10', undefined, 'mn11');
    expect(navigate).toHaveBeenLastCalledWith('/read/an4.10', {
      state: { from: '/browse/sn1', backTo: 'mn11', navId: expect.any(String) },
      replace: false,
    });

    // A hit naming a passage in the sutta the way back leads to opens it there, as a step of its own.
    rerender({ from: '/browse/sn1', backTo: 'mn11' });
    const markedBy = { queries: ['sati'], anywhere: false };
    result.current.jumpTo('mn11', { segments: ['mn11:3.1', 'mn11:3.2'], paliSegments: ['mn11:3.2'], markedBy }, 'an4.10');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn11?at=3.1-3.2&pali=3.2&q=sati', {
      state: expect.objectContaining({
        segments: ['mn11:3.1', 'mn11:3.2'],
        paliSegments: ['mn11:3.2'],
        markedBy,
        backTo: 'an4.10',
      }),
      replace: false,
    });

    // Without a passage, a jump or a turn onto it is the way back.
    result.current.jumpTo('mn11', undefined, 'an4.10');
    expect(navigate).toHaveBeenLastCalledWith(-1);
    navigate.mockClear();
    result.current.turnTo('mn11');
    expect(navigate).toHaveBeenLastCalledWith(-1);
  });

  it('preserves a reference translator and never uses an alternate history entry for Next/Prev', () => {
    const initialProps: Parameters<typeof useReaderOrigin>[0] = { from: '/browse/mn' };
    const { result, rerender } = renderHook((state) => useReaderOrigin(state), { initialProps });
    result.current.jumpTo('mn10', { segments: ['mn10:2.7', 'mn10:2.7'] }, 'mn9', 'bodhi', 'thanissaro');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn10?by=bodhi&at=2.7', {
      state: expect.objectContaining({ backTo: 'mn9', backBy: 'thanissaro' }), replace: false,
    });
    rerender({ backTo: 'mn9', backBy: 'thanissaro' });
    result.current.turnTo('mn9');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn9', expect.objectContaining({ replace: true }));
    result.current.jumpTo('mn9', undefined, 'mn10', 'thanissaro', 'bodhi');
    expect(navigate).toHaveBeenLastCalledWith(-1);
    result.current.jumpTo('mn9', undefined, 'mn10', 'bodhi', 'bodhi');
    expect(navigate).toHaveBeenLastCalledWith('/read/mn9?by=bodhi', expect.objectContaining({ replace: false }));
  });

  it('a jump to a passage in a batch names the inner sutta its lines belong to', () => {
    const { result } = renderHook(() => useReaderOrigin({ from: '/browse/dhp' }));
    result.current.jumpTo('dhp273-289', { segments: ['dhp274:4', 'dhp274:4'] }, 'mn10');
    expect(navigate).toHaveBeenLastCalledWith('/read/dhp274?at=4', expect.anything());
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

    // Flushed, so the fade out of the Reader captures the Library already in place
    // (lib/ui/motion.ts).
    expect(navigate).toHaveBeenCalledWith('/fallback', { flushSync: true });
  });

  it('closeToOrigin falls back to fallbackPath when there is no origin at all', () => {
    const { result } = renderHook(() => useReaderOrigin(undefined));
    result.current.closeToOrigin('sn1.1', '/fallback');

    expect(navigate).toHaveBeenCalledWith('/fallback', { flushSync: true });
  });
});
