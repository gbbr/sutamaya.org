import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadCorpus } from '../lib/corpus';
import type { Corpus } from '../lib/types';

interface CorpusState {
  corpus: Corpus | null;
  loading: boolean;
  // Set when the corpus.json fetch failed; the only way out of `loading` other than `corpus`.
  error: boolean;
  retry: () => void;
}

const CorpusContext = createContext<CorpusState | null>(null);

// Holds the browse tree and sutta index (corpus.json). Not the dictionary, which is fetched one
// range shard at a time by the tap that needs it (lib/dictionaryShards.ts).
export function CorpusProvider({ children }: { children: ReactNode }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(false);
    loadCorpus()
      .then(setCorpus)
      .catch((e) => {
        console.error('Failed to load corpus', e);
        setError(true);
      });
  }, [attempt]);

  const retry = useMemo(() => () => setAttempt((n) => n + 1), []);

  const value = useMemo(
    () => ({ corpus, loading: !corpus && !error, error, retry }),
    [corpus, error, retry]
  );
  return <CorpusContext.Provider value={value}>{children}</CorpusContext.Provider>;
}

export function useCorpus() {
  const ctx = useContext(CorpusContext);
  if (!ctx) throw new Error('useCorpus must be used within CorpusProvider');
  return ctx;
}
