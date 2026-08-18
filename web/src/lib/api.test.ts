import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, dataApi, notesApi } from './api';

// These cover request()'s shared plumbing — the timeout wiring and how a failure is reported —
// rather than any individual endpoint; notesApi.set is just the cheapest caller to drive it with.
describe('request()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Typed with fetch's own parameters (rather than as a bare thunk) so the recorded calls carry
  // the `init` argument the first test below reads back.
  function stubFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('attaches an abort signal, so a stalled connection cannot hang for the browser default', async () => {
    const fetchMock = stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await notesApi.set('dn1', 'a note', '2026-01-01T00:00:00.000Z|dev');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Placed after the `...init` spread — a caller-supplied signal must not be able to silently
    // replace it and reintroduce the unbounded hang.
    expect(init.signal?.aborted).toBe(false);
  });

  it('reports a timed-out request as a legible error rather than a bare DOMException', async () => {
    stubFetch(async () => {
      throw new DOMException('signal timed out', 'TimeoutError');
    });

    // Every mutator logs its failure via console.error (see UserDataContext) — "signal timed out"
    // there says nothing about what actually happened.
    await expect(notesApi.set('dn1', 'a note', '2026-01-01T00:00:00.000Z|dev')).rejects.toThrow(/timed out after 30s/);
  });

  it('reports a timeout that lands during the body read the same way', async () => {
    // The signal aborts the response stream too, so a payload still arriving at the deadline
    // rejects on res.json(), not at fetch() — and /api/data, the whole user dataset, is the call
    // that actually gets that far.
    stubFetch(
      async () =>
        ({
          ok: true,
          status: 200,
          json: () => Promise.reject(new DOMException('signal timed out', 'TimeoutError')),
        }) as unknown as Response
    );

    await expect(dataApi.all()).rejects.toThrow(/timed out after 30s/);
  });

  it('leaves a non-timeout network failure untouched', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(notesApi.set('dn1', 'a note', '2026-01-01T00:00:00.000Z|dev')).rejects.toThrow('Failed to fetch');
  });

  it('still surfaces the server error body on a non-ok response', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }));

    await expect(notesApi.set('dn1', 'a note', '2026-01-01T00:00:00.000Z|dev')).rejects.toThrow('rate_limited');
  });

  it('attaches the HTTP status to the thrown error, so callers can classify it', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));

    const err = await notesApi.set('dn1', 'a note', '2026-01-01T00:00:00.000Z|dev').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});
