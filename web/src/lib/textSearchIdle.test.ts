// Loading the search text, doing without it, and releasing it once the app has been out of sight —
// the memory half of docs/search.md's "What it costs the device", and its "Late, or never".
//
// Its own file, and a jsdom one, because it drives `visibilitychange` on a real document and a
// mocked `fetch`; the rest of the module's tests are pure and stay on Node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginTextSearchLoad,
  resetTextSearch,
  textSearchSnapshot,
  watchTextSearchIdle,
} from './textSearch';
import type { Corpus } from './types';

const corpus = { dataVersion: 'v1' } as Corpus;

// The three files a load fetches: two blobs and the map.
function serveText() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('.json')
        ? { ok: true, json: async () => [['a', 0, 0]] }
        : { ok: true, text: async () => '\x1e\na line' }
    )
  );
}

function visibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// Lets the mocked fetch's promises settle while the timers are faked.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the search text, loaded and released', () => {
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    stop = watchTextSearchIdle();
  });

  afterEach(() => {
    stop();
    visibility('visible');
    resetTextSearch();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('holds the text while the app is on screen', async () => {
    serveText();
    beginTextSearchLoad(corpus);
    await settle();
    expect(textSearchSnapshot().status).toBe('ready');

    visibility('visible');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(textSearchSnapshot().status).toBe('ready');
  });

  it('releases it once the app has been hidden long enough', async () => {
    serveText();
    beginTextSearchLoad(corpus);
    await settle();

    visibility('hidden');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(textSearchSnapshot().status).toBe('idle');
    expect(textSearchSnapshot().index).toBe(null);
  });

  it('keeps it when the app comes back before the delay is up', async () => {
    serveText();
    beginTextSearchLoad(corpus);
    await settle();

    visibility('hidden');
    await vi.advanceTimersByTimeAsync(1000);
    visibility('visible');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(textSearchSnapshot().status).toBe('ready');
  });

  it('loads again after a release, and after a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    beginTextSearchLoad(corpus);
    await settle();
    expect(textSearchSnapshot().status).toBe('unavailable');

    // A failed fetch is not remembered: the reader who searched offline gets the text once back.
    serveText();
    beginTextSearchLoad(corpus);
    await settle();
    expect(textSearchSnapshot().status).toBe('ready');
  });
});
