import { describe, expect, it } from 'vitest';
import {
  PUT_ASIDE_CAP,
  addPutAside,
  normalizePutAside,
  phoneTab,
  removePutAside,
  trackPutAside,
  type PutAsideEntry,
} from './putAside';
// @ts-expect-error -- plain-JS worker module, no .d.ts across the workspace boundary
import { PUT_ASIDE_CAP as WORKER_PUT_ASIDE_CAP } from '../../../worker/src/lib/writes.js';

const at = (suttaId: string, pct = 0): PutAsideEntry => ({ suttaId, key: `${suttaId}:1.1`, pct });
const ids = (entries: PutAsideEntry[]) => entries.map((e) => e.suttaId);

describe('addPutAside', () => {
  it('joins the end, as a browser tab does, so no existing slot moves', () => {
    expect(ids(addPutAside([at('mn1'), at('mn2')], at('mn3')))).toEqual(['mn1', 'mn2', 'mn3']);
  });

  it('keeps the slot of a sutta already in the set, refreshing only its position', () => {
    const next = addPutAside([at('mn1', 5), at('mn2', 10)], at('mn1', 70));
    expect(ids(next)).toEqual(['mn1', 'mn2']);
    expect(next[0].pct).toBe(70);
  });

  // The bar gates this at the cap, the reader closing a tab before another sutta joins. The trim
  // is the floor under a set that arrived full from another device mid-gesture.
  it('holds the cap, the oldest falling off the front', () => {
    const full = Array.from({ length: PUT_ASIDE_CAP }, (_, i) => at(`mn${i}`));
    const next = addPutAside(full, at('new'));
    expect(next).toHaveLength(PUT_ASIDE_CAP);
    expect(ids(next)[PUT_ASIDE_CAP - 1]).toBe('new');
    expect(ids(next)).not.toContain('mn0');
  });
});

// A tab holds the line its sutta was last left on, the way a browser tab holds its scroll — but
// only for a sutta that already has one.
describe('trackPutAside', () => {
  it('moves a held tab to the line it is left on, keeping its slot', () => {
    const next = trackPutAside([at('mn1', 5), at('mn2', 10)], at('mn1', 62));
    expect(ids(next)).toEqual(['mn1', 'mn2']);
    expect(next[0].pct).toBe(62);
  });

  it('leaves a sutta the set does not hold out of it, reading alone earning no tab', () => {
    const entries = [at('mn1')];
    expect(trackPutAside(entries, at('mn9', 40))).toBe(entries);
  });

  it('answers the same set where nothing moved, so an idle exit dirties no record', () => {
    const entries = [at('mn1', 30)];
    expect(ids(trackPutAside(entries, at('mn1', 30)))).toEqual(['mn1']);
  });

  it('tracks a held tab in a full set without disturbing what it holds', () => {
    const full = Array.from({ length: PUT_ASIDE_CAP }, (_, i) => at(`mn${i}`, 5));
    const next = trackPutAside(full, at('mn3', 80));
    expect(ids(next)).toEqual(ids(full));
    expect(next[3].pct).toBe(80);
  });
});

describe('phoneTab', () => {
  it('offers the last tab the reader left, which is the way back', () => {
    expect(phoneTab([at('mn1'), at('mn2'), at('mn3')], 'mn3')?.suttaId).toBe('mn2');
  });

  it('falls to the active tab where there is no other, so the bar keeps its place', () => {
    expect(phoneTab([at('mn1')], 'mn1')?.suttaId).toBe('mn1');
  });

  it('offers the newest where nothing is being read', () => {
    expect(phoneTab([at('mn1'), at('mn2')], undefined)?.suttaId).toBe('mn2');
  });

  it('has nothing to offer for an empty set', () => {
    expect(phoneTab([], 'mn1')).toBeNull();
  });
});

describe('removePutAside', () => {
  it('drops just the one named', () => {
    expect(ids(removePutAside([at('mn1'), at('mn2')], 'mn1'))).toEqual(['mn2']);
  });
});

describe('normalizePutAside', () => {
  it('drops malformed entries and duplicates, and caps the rest', () => {
    const raw = [at('mn1'), null, { suttaId: 'mn2' }, at('mn1', 50), at('mn3')];
    expect(ids(normalizePutAside(raw))).toEqual(['mn1', 'mn3']);
    const over = Array.from({ length: PUT_ASIDE_CAP + 2 }, (_, i) => at(`mn${i}`));
    expect(ids(normalizePutAside(over))).toEqual(ids(over.slice(-PUT_ASIDE_CAP)));
  });

  it('clamps a percentage from the wire into range', () => {
    expect(normalizePutAside([at('mn1', 140)])[0].pct).toBe(100);
    expect(normalizePutAside([at('mn1', -5)])[0].pct).toBe(0);
  });

  it('answers an empty set for anything that isn’t an array', () => {
    expect(normalizePutAside(undefined)).toEqual([]);
    expect(normalizePutAside('mn1')).toEqual([]);
  });
});

// The cap is duplicated across the two npm workspaces, nothing being shared between them. This is
// the tripwire: a client that trims to a different length than the server stores would silently
// lose the tail of the set on the next sync.
describe('the cap stays in sync between web and worker', () => {
  it('is the same number on both sides', () => {
    expect(PUT_ASIDE_CAP).toBe(WORKER_PUT_ASIDE_CAP);
  });
});
