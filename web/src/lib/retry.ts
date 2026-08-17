const RETRY_DELAYS_MS = [500, 1500, 3000];

// A status-less failure (network error, or the app's own client-side request timeout — both
// surface as a bare Error, see api.ts) is retryable: it says nothing about whether the same
// request would fail again. An HTTP status is retryable only if it's the kind that can plausibly
// succeed on its own next time — a rate limit, a server-side hiccup, or the server's own 408 — not
// a 400/404 that will just fail identically forever.
export function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

// Duck-typed rather than `instanceof ApiError` deliberately: importing the class here would couple
// this module to api.ts, and every test that mocks '../lib/api' wholesale (AuthContext,
// UserDataContext) would need to know to re-export it. A `status` field is all this needs.
function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

// Retries `fn` with the app's standard backoff schedule for a flaky network call: a couple of
// silent retries first (offline blips, a cold CDN edge), rejecting with the last error only once
// those are exhausted or the failure is permanent. Shared by AuthContext (loading the signed-in
// session) and useSuttaText (loading a sutta's text), both of which used to duplicate this loop.
export async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(statusOf(err)) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}
