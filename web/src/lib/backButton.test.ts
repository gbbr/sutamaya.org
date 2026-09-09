import { describe, expect, it, vi } from 'vitest';
import { registerBackHandler, runTopBackHandler } from './backButton';

describe('back handler stack', () => {
  it('runs the most recently registered handler and reports it ran', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerBackHandler(first);
    const unregisterSecond = registerBackHandler(second);

    expect(runTopBackHandler()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    unregisterSecond();
    expect(runTopBackHandler()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);

    unregisterFirst();
    expect(runTopBackHandler()).toBe(false);
  });

  it('unregistering a buried handler leaves the rest in order', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unregisterA = registerBackHandler(a);
    const unregisterB = registerBackHandler(b);

    unregisterA();
    expect(runTopBackHandler()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);

    unregisterB();
    expect(runTopBackHandler()).toBe(false);
  });
});
