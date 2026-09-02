const RETRY_DELAYS_MS = [500, 1500, 3000];

// True when another attempt could plausibly succeed: a rate limit, a server-side failure, a 408,
// or a status-less failure — a network error or a client timeout, which says nothing either way.
export function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

// An error's HTTP status, if it carries one. Duck-typed rather than `instanceof ApiError`, so this
// module doesn't depend on api.ts and a test mocking it wholesale needn't re-export the class.
export function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

// Retries `fn` on the app's standard backoff schedule, rejecting with the last error once the
// retries are exhausted or the failure is permanent.
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
