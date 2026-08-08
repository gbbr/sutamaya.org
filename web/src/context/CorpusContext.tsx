import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadCorpus, loadDictionary } from '../lib/corpus';
import type { Corpus, Dictionary } from '../lib/types';

interface CorpusState {
  corpus: Corpus | null;
  dictionary: Dictionary | null;
  loading: boolean;
  // Set if the initial corpus.json fetch itself failed (offline first load, cold cache miss, a
  // CDN hiccup) — without this, a failed fetch left `loading` true forever with no way out, since
  // nothing else ever resolves `corpus`. The dictionary's own failure isn't surfaced here: it
  // loads in the background and its only consumer already null-checks it (see below).
  error: boolean;
  retry: () => void;
}

const CorpusContext = createContext<CorpusState | null>(null);

export function CorpusProvider({ children }: { children: ReactNode }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
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
    loadDictionary()
      .then(setDictionary)
      .catch((e) => console.error('Failed to load dictionary', e));
  }, [attempt]);

  const retry = useMemo(() => () => setAttempt((n) => n + 1), []);

  // Only `corpus` gates first paint — it's a few MB and is all the browse tree/reader need to
  // render. `dictionary` (~20MB, loaded off-thread — see loadDictionary()) keeps loading in the
  // background; its only consumer (ReaderPage's word-tap lookup) already null-checks it.
  const value = useMemo(() => ({ corpus, dictionary, loading: !corpus && !error, error, retry }), [corpus, dictionary, error, retry]);
  return <CorpusContext.Provider value={value}>{children}</CorpusContext.Provider>;
}

export function useCorpus() {
  const ctx = useContext(CorpusContext);
  if (!ctx) throw new Error('useCorpus must be used within CorpusProvider');
  return ctx;
}
