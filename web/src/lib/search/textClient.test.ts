// The worker's lifecycle as the app drives it: loading the search text, doing without it, and
// running one search at a time — docs/search.md's "Late, or never".
//
// The module holds the worker in module state, so each test imports it fresh rather than resetting
// it through an export the app itself would never call.
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// The searches a worker has been given, in order.
const searches = (w: FakeWorker) => w.posted.filter((m) => m.type === 'search');

describe('the search text, loaded and searched', () => {
  let client: typeof import('./textClient');

  beforeEach(async () => {
    vi.resetModules();
    FakeWorker.live = [];
    vi.stubGlobal('Worker', FakeWorker);
    client = await import('./textClient');
  });

  // The last worker created, loaded and ready to answer searches.
  function load() {
    client.beginTextSearchLoad(corpus);
    FakeWorker.latest().reply({ type: 'status', status: 'ready' });
    return FakeWorker.latest();
  }

  it('fetches the text once, and holds it for the life of the page', () => {
    const worker = load();
    expect(client.textSearchStatus()).toBe('ready');

    // Every later focus and keystroke asks again; none of them refetches.
    client.beginTextSearchLoad(corpus);
    client.beginTextSearchLoad(corpus);
    expect(FakeWorker.live).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    expect(client.textSearchStatus()).toBe('ready');
  });

  it('loads again after a failure', () => {
    client.beginTextSearchLoad(corpus);
    expect(client.textSearchStatus()).toBe('loading');
    FakeWorker.latest().reply({ type: 'status', status: 'unavailable' });
    expect(client.textSearchStatus()).toBe('unavailable');

    // A failed load is not remembered: the reader who searched offline gets the text once back.
    load();
    expect(client.textSearchStatus()).toBe('ready');
  });

  it('searches without the text, and without a worker at all', async () => {
    expect(await client.searchText('greed', [])).toBe(null);

    vi.stubGlobal('Worker', undefined);
    client.beginTextSearchLoad(corpus);
    expect(client.textSearchStatus()).toBe('unavailable');
    expect(await client.searchText('greed', [])).toBe(null);
  });

  it("answers a search with the worker's merged hits", async () => {
    const worker = load();
    const hits: RankedHit[] = [{ id: 'sn56.11', rank: 4, saved: false }];

    const answer = client.searchText('greed', []);
    const [sent] = searches(worker);
    worker.reply({ type: 'result', id: sent.id, hits });
    expect(await answer).toEqual(hits);
  });

  it('runs one search at a time, and drops the ones typed over', async () => {
    const worker = load();

    const first = client.searchText('gre', []);
    const dropped = client.searchText('gree', []);
    const latest = client.searchText('greed', []);
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
