import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadCorpus } from '../lib/corpus';
import type { Corpus } from '../lib/types';

interface CorpusState {
  corpus: Corpus | null;
  loading: boolean;
  // Set when the initial corpus.json fetch failed — an offline first load, a cold cache miss, a CDN
  // hiccup. Nothing else ever resolves `corpus`, so this is the only way out of `loading`.
  error: boolean;
  retry: () => void;
}

const CorpusContext = createContext<CorpusState | null>(null);

// The dictionary is deliberately absent from this provider: it is fetched one range shard at a
// time, by the tap that needs it (lib/dictionaryShards.ts, through useDictionaryLookup), so there
// is no app-wide dictionary state, no boot-time load to gate, and nothing resident between lookups.
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
