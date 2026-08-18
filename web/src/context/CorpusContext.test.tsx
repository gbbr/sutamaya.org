import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Corpus } from '../lib/types';

vi.mock('../lib/corpus', () => ({ loadCorpus: vi.fn() }));

function Probe({ useCorpusHook }: { useCorpusHook: () => ReturnType<typeof import('./CorpusContext').useCorpus> }) {
  const { corpus, loading, error, retry } = useCorpusHook();
  return (
    <div>
      <span data-testid="corpus">{corpus ? 'loaded' : 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{String(error)}</span>
      <button data-testid="retry" onClick={retry} />
    </div>
  );
}

const testCorpus = { nikayas: [], suttas: {} } as unknown as Corpus;

// The dictionary isn't part of this provider — it's fetched per word tap, one shard at a time (see
// lib/dictionaryShards.ts), so what's left here is only corpus.json's own load/error/retry cycle.
describe('CorpusContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function renderProvider() {
    const { CorpusProvider, useCorpus } = await import('./CorpusContext');
    render(
      <CorpusProvider>
        <Probe useCorpusHook={useCorpus} />
      </CorpusProvider>
    );
  }

  it('exposes the corpus once it loads, and stops reporting loading', async () => {
    const { loadCorpus } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockResolvedValue(testCorpus);

    await act(async () => {
      await renderProvider();
    });

    expect(screen.getByTestId('corpus').textContent).toBe('loaded');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('false');
  });

  it('surfaces a failed corpus load as an error rather than loading forever', async () => {
    const { loadCorpus } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockRejectedValue(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await renderProvider();
    });

    // `loading` has to go false too — nothing else ever resolves `corpus`, so a provider still
    // claiming to be loading leaves the app on its spinner with no way out.
    expect(screen.getByTestId('error').textContent).toBe('true');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    consoleError.mockRestore();
  });

  it('retry() re-fetches the corpus and clears the error on success', async () => {
    const { loadCorpus } = await import('../lib/corpus');
    vi.mocked(loadCorpus).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(testCorpus);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await renderProvider();
    });
    expect(screen.getByTestId('error').textContent).toBe('true');

    await act(async () => {
      screen.getByTestId('retry').click();
    });

    expect(loadCorpus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('corpus').textContent).toBe('loaded');
    expect(screen.getByTestId('error').textContent).toBe('false');
    consoleError.mockRestore();
  });
});
