import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastLocation, rememberLocation } from '../lastLocation';

beforeEach(() => {
  // An in-memory localStorage, fresh per test, as in lib/ui/__tests__/uiPrefs.test.ts.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  });
});

describe('rememberLocation', () => {
  it("keeps the translation a Reader location names, unless it is Sujato's", () => {
    rememberLocation('/read/mn1', 'bodhi');
    expect(getLastLocation()).toBe('/read/mn1?by=bodhi');
    rememberLocation('/read/mn1', 'sujato');
    expect(getLastLocation()).toBe('/read/mn1');
  });

  it('keeps a translation only for the Reader', () => {
    rememberLocation('/browse/mn/mn1', 'bodhi');
    expect(getLastLocation()).toBe('/browse/mn/mn1');
  });
});
