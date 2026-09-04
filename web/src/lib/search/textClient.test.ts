// The worker's lifecycle as the app drives it: loading the search text, doing without it, running
// one search at a time, and releasing the text once the app has been out of sight — the memory half
// of docs/search.md's "What it costs the device", and its "Late, or never".
//
// Its own file, and a jsdom one, because it drives `visibilitychange` on a real document and a
// stubbed `Worker`; the rest of search's tests are pure and stay on Node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginTextSearchLoad,
  resetTextSearch,
  searchText,
  textSearchStatus,
  watchTextSearchIdle,
} from './textClient';
import type { RankedHit } from './text';
import type { Corpus } from '../types';

const corpus = { dataVersion: 'v1' } as Corpus;

// Stands in for lib/search/worker.ts: it records what was posted to it and answers only when a test
// says so, which is what lets a search be observed while it is still in flight.
class FakeWorker {
  static live: FakeWorker[] = [];
  posted: Array<Record<string, unknown>> = [];
  terminated = false;
  private listeners: Array<(e: MessageEvent) => void> = [];

  constructor() {
    FakeWorker.live.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (type === 'message') this.listeners.push(fn);
  }
  postMessage(msg: Record<string, unknown>) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  // Delivers one of lib/search/worker.ts's replies.
  reply(data: unknown) {
    for (const fn of this.listeners) fn({ data } as MessageEvent);
  }
  static latest() {
    return FakeWorker.live[FakeWorker.live.length - 1];
  }
}

// The last worker created, loaded and ready to answer searches.
function load() {
  beginTextSearchLoad(corpus);
  FakeWorker.latest().reply({ type: 'status', status: 'ready' });
  return FakeWorker.latest();
}

// The searches a worker has been given, in order.
const searches = (w: FakeWorker) => w.posted.filter((m) => m.type === 'search');

function visibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('the search text, loaded and released', () => {
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.live = [];
    vi.stubGlobal('Worker', FakeWorker);
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
    load();
    expect(textSearchStatus()).toBe('ready');

    visibility('visible');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(textSearchStatus()).toBe('ready');
  });

  it('releases it once the app has been hidden long enough', async () => {
    const worker = load();

    visibility('hidden');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(textSearchStatus()).toBe('idle');
    expect(worker.terminated).toBe(true);
  });

  it('keeps it when the app comes back before the delay is up', async () => {
    load();

    visibility('hidden');
    await vi.advanceTimersByTimeAsync(1000);
    visibility('visible');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(textSearchStatus()).toBe('ready');
  });

  it('loads again after a release, and after a failure', () => {
    beginTextSearchLoad(corpus);
    expect(textSearchStatus()).toBe('loading');
    FakeWorker.latest().reply({ type: 'status', status: 'unavailable' });
    expect(textSearchStatus()).toBe('unavailable');

    // A failed load is not remembered: the reader who searched offline gets the text once back.
    load();
    expect(textSearchStatus()).toBe('ready');
  });

  it('searches without the text, and without a worker at all', async () => {
    expect(await searchText('greed', [])).toBe(null);

    vi.stubGlobal('Worker', undefined);
    beginTextSearchLoad(corpus);
    expect(textSearchStatus()).toBe('unavailable');
    expect(await searchText('greed', [])).toBe(null);
  });

  it("answers a search with the worker's merged hits", async () => {
    const worker = load();
    const hits: RankedHit[] = [{ id: 'sn56.11', rank: 4, saved: false }];

    const answer = searchText('greed', []);
    const [sent] = searches(worker);
    worker.reply({ type: 'result', id: sent.id, hits });
    expect(await answer).toEqual(hits);
  });

  it('runs one search at a time, and drops the ones typed over', async () => {
    const worker = load();

    const first = searchText('gre', []);
    const dropped = searchText('gree', []);
    const latest = searchText('greed', []);
    expect(searches(worker)).toHaveLength(1);
    // The one in flight is answered, and the newest of those waiting goes next; the middle
    // keystroke is never scanned.
    expect(await dropped).toBe(null);

    worker.reply({ type: 'result', id: searches(worker)[0].id, hits: [] });
    expect(await first).toEqual([]);
    expect(searches(worker)).toHaveLength(2);
    expect(searches(worker)[1].query).toBe('greed');

    worker.reply({ type: 'result', id: searches(worker)[1].id, hits: [] });
    expect(await latest).toEqual([]);
  });
});
