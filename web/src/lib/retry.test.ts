import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { isRetryable, retryWithBackoff } from './retry';

describe('isRetryable', () => {
  it('treats a status-less failure (network error, timeout) as retryable', () => {
    expect(isRetryable(undefined)).toBe(true);
  });

  it('treats a request timeout, a rate limit, and any server error as retryable', () => {
    expect(isRetryable(408)).toBe(true);
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
  });

  it('treats an ordinary client error as permanent', () => {
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(404)).toBe(false);
  });
});

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects immediately on a 4xx, without sleeping through the retry schedule', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError('not_found', 404));

    // The assertion attaches to the promise synchronously, in the same tick it's created — attaching
    // it only after advancing timers below leaves a window where Node sees the rejection as
    // unhandled, even though this test does go on to handle it.
    const assertion = expect(retryWithBackoff(fn)).rejects.toThrow('not_found');
    // No timers advanced at all — a permanent failure must not wait on the first retry delay.
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts the schedule on a 500 before giving up', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError('internal_error', 500));

    const assertion = expect(retryWithBackoff(fn)).rejects.toThrow('internal_error');
    await vi.advanceTimersByTimeAsync(500 + 1500 + 3000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('exhausts the schedule on a plain network error before giving up', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const assertion = expect(retryWithBackoff(fn)).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(500 + 1500 + 3000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('exhausts the schedule on a request timeout before giving up', async () => {
    // api.ts reports a timeout as a bare Error with no status attached — same shape as a network
    // failure, and must be classified the same way.
    const fn = vi.fn().mockRejectedValue(new Error('Request timed out after 30s'));

    const assertion = expect(retryWithBackoff(fn)).rejects.toThrow('Request timed out after 30s');
    await vi.advanceTimersByTimeAsync(500 + 1500 + 3000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('retries a retryable failure and returns once it succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ApiError('rate_limited', 429)).mockResolvedValueOnce('ok');

    const assertion = expect(retryWithBackoff(fn)).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
