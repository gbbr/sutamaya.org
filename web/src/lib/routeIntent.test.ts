import { beforeEach, describe, expect, it } from 'vitest';
import { consumeIntent, tagIntent } from './routeIntent';

const KEY = 'test.routeIntent';

describe('routeIntent', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('tags state with a fresh navId', () => {
    const a = tagIntent({ fromView: 'tree' });
    const b = tagIntent({ fromView: 'tree' });
    expect(a.navId).toBeTruthy();
    expect(b.navId).toBeTruthy();
    expect(a.navId).not.toBe(b.navId);
    expect(a.fromView).toBe('tree');
  });

  it('consumes a fresh intent once and returns it', () => {
    const state = tagIntent({ fromView: 'list' as const });
    expect(consumeIntent(state, KEY)).toEqual(state);
  });

  it('returns null for the same intent consumed a second time (stale/resurrected history.state)', () => {
    const state = tagIntent({ fromView: 'list' as const });
    expect(consumeIntent(state, KEY)).toEqual(state);
    // Simulates a hard refresh: the same history.state object survives, but it's already been
    // acted on once — a second consumeIntent() call must not resurrect it.
    expect(consumeIntent(state, KEY)).toBeNull();
  });

  it('returns null for no state at all', () => {
    expect(consumeIntent(undefined, KEY)).toBeNull();
    expect(consumeIntent(null, KEY)).toBeNull();
  });

  it('returns null for state without a navId (never tagged)', () => {
    expect(consumeIntent({ fromView: 'tree' } as never, KEY)).toBeNull();
  });

  it('a later intent is consumed independently, and refreshing on it goes stale in turn', () => {
    const first = tagIntent({ fromView: 'tree' as const });
    const second = tagIntent({ fromView: 'list' as const });
    expect(consumeIntent(first, KEY)).toEqual(first);
    // A second, unrelated navigation's intent is still honored once (only the *same* intent
    // resurrected — i.e. an actual refresh on this exact history entry — should go stale).
    expect(consumeIntent(second, KEY)).toEqual(second);
    // Simulated refresh on the second navigation's own entry: now stale.
    expect(consumeIntent(second, KEY)).toBeNull();
  });

  it('keeps separate storage keys independent', () => {
    const state = tagIntent({ fromView: 'tree' as const });
    expect(consumeIntent(state, 'test.routeIntent.a')).toEqual(state);
    expect(consumeIntent(state, 'test.routeIntent.b')).toEqual(state);
  });
});
