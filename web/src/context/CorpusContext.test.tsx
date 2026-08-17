import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Corpus, Dictionary } from '../lib/types';

vi.mock('../lib/corpus', () => ({ loadCorpus: vi.fn(), loadDictionary: vi.fn() }));

function Probe({ useCorpusHook }: { useCorpusHook: () => ReturnType<typeof import('./CorpusContext').useCorpus> }) {
  const { corpus, dictionary, loading, error, retry, retryDictionary } = useCorpusHook();
  return (
    <div>
      <span data-testid="corpus">{corpus ? 'loaded' : 'none'}</span>
      <span data-testid="dictionary">{dictionary ? 'loaded' : 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{String(error)}</span>
      <button data-testid="retry" onClick={retry} />
      <button data-testid="retryDictionary" onClick={retryDictionary} />
    </div>
  );
}

const testCorpus = { nikayas: [], suttas: {} } as unknown as Corpus;
const testDictionary = { entry: ['def'] } as unknown as Dictionary;

describe('CorpusContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('leaves the dictionary null after every backoff attempt fails, without ever retrying on its own', async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    vi.mocked(loadDictionary).mockRejectedValue(new Error('network down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );

    // 1 initial attempt + 3 retries (RETRY_DELAYS_MS = [500, 1500, 3000]) — all fail while offline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0 + 500 + 1500 + 3000 + 100);
    });

    expect(loadDictionary).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId('dictionary').textContent).toBe('none');

    // No further attempts without an 'online'/visibility trigger — this is the bug: waiting alone
    // never recovered, only closing and reopening the app (a fresh CorpusProvider mount) did.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(loadDictionary).toHaveBeenCalledTimes(4);
    consoleError.mockRestore();
  });

  it('retries the dictionary once the device reports back online, and succeeds', async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    vi.mocked(loadDictionary).mockRejectedValue(new Error('network down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0 + 500 + 1500 + 3000 + 100);
    });
    expect(screen.getByTestId('dictionary').textContent).toBe('none');

    vi.mocked(loadDictionary).mockResolvedValue(testDictionary);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    consoleError.mockRestore();
  });

  it('does not retry once the dictionary has already loaded', async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    vi.mocked(loadDictionary).mockResolvedValue(testDictionary);

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    expect(loadDictionary).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loadDictionary).toHaveBeenCalledTimes(1);
  });

  it('ignores an online/visibility event that fires while the dictionary is still on its first, in-flight attempt', async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    let resolveDictionary!: (d: Dictionary) => void;
    vi.mocked(loadDictionary).mockReturnValue(new Promise((resolve) => (resolveDictionary = resolve)));

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loadDictionary).toHaveBeenCalledTimes(1);

    // A stray 'online'/visibilitychange right at a cold PWA launch, while the very first attempt
    // hasn't settled yet, must not spawn a second concurrent Worker+fetch racing the first one —
    // only a genuine, exhausted failure should trigger a retry.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loadDictionary).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDictionary(testDictionary);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    expect(loadDictionary).toHaveBeenCalledTimes(1);
  });

  it('ignores a second online event that fires mid-retry, without stacking a second concurrent attempt', async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    let calls = 0;
    vi.mocked(loadDictionary).mockImplementation(() => {
      calls++;
      // Calls 1-4: the initial cycle, all fail. Call 5: the retry cycle's first sub-attempt, also
      // fails — so the retry cycle is genuinely still in flight, mid its own backoff, when the
      // second online event below fires. Call 6: the retry cycle's second sub-attempt, succeeds.
      if (calls <= 5) return Promise.reject(new Error('network down'));
      return Promise.resolve(testDictionary);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );

    // Initial cycle exhausts (1 + 3 retries).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0 + 500 + 1500 + 3000 + 100);
    });
    expect(calls).toBe(4);

    // First online event starts the retry cycle (call 5, which also fails).
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(5);

    // A second online event lands while that retry cycle is still genuinely in flight — this is
    // the bug: `dictionaryFailedRef` used to only clear on success, so it still read "failed" here
    // and this event would fire a second, stacked retryWithBackoff(loadDictionary) call on top of
    // the one already running.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(5);

    // The one genuine retry cycle's own backoff elapses and its second attempt succeeds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(calls).toBe(6);
    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    consoleError.mockRestore();
  });

  it("doesn't let a dictionary retry re-fetch corpus.json, and vice versa", async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    vi.mocked(loadDictionary).mockRejectedValue(new Error('network down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0 + 500 + 1500 + 3000 + 100);
    });
    expect(loadCorpus).toHaveBeenCalledTimes(1);
    expect(loadDictionary).toHaveBeenCalledTimes(4);

    vi.mocked(loadDictionary).mockResolvedValue(testDictionary);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Corpus (already loaded, and never failed) isn't re-fetched just because the dictionary was.
    expect(loadCorpus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    consoleError.mockRestore();
  });

  it("retry() retries both a failed corpus load and a failed dictionary load together, without waiting on a separate online event", async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockRejectedValue(new Error('corpus down'));
    vi.mocked(loadDictionary).mockRejectedValue(new Error('dictionary down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0 + 500 + 1500 + 3000 + 100);
    });
    expect(screen.getByTestId('error').textContent).toBe('true');
    expect(loadCorpus).toHaveBeenCalledTimes(1);
    expect(loadDictionary).toHaveBeenCalledTimes(4);

    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    vi.mocked(loadDictionary).mockResolvedValue(testDictionary);
    await act(async () => {
      screen.getByTestId('retry').click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('corpus').textContent).toBe('loaded');
    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    consoleError.mockRestore();
  });

  it('retryDictionary() recovers a dictionary that failed to load, matching what SettingsPage does after an out-of-band successful cache write', async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    vi.mocked(loadDictionary).mockRejectedValue(new Error('network down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0 + 500 + 1500 + 3000 + 100);
    });
    expect(screen.getByTestId('dictionary').textContent).toBe('none');
    expect(loadDictionary).toHaveBeenCalledTimes(4);

    vi.mocked(loadDictionary).mockResolvedValue(testDictionary);
    await act(async () => {
      screen.getByTestId('retryDictionary').click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    expect(loadDictionary).toHaveBeenCalledTimes(5);
    consoleError.mockRestore();
  });

  it('retryDictionary() is a no-op when the dictionary has not failed', async () => {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    const { loadCorpus, loadDictionary } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);
    vi.mocked(loadDictionary).mockResolvedValue(testDictionary);

    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('dictionary').textContent).toBe('loaded');
    expect(loadDictionary).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByTestId('retryDictionary').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loadDictionary).toHaveBeenCalledTimes(1);
  });
});
