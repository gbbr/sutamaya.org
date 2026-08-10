const RETRY_DELAYS_MS = [500, 1500, 3000];

// Retries `fn` with the app's standard backoff schedule for a flaky network call: a couple of
// silent retries first (offline blips, a cold CDN edge), rejecting with the last error only once
// those are exhausted. Shared by AuthContext (loading the signed-in session) and useSuttaText
// (loading a sutta's text), both of which used to duplicate this loop.
export async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}
