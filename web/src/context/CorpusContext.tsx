import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadCorpus, loadDictionary } from '../lib/corpus';
import type { Corpus, Dictionary } from '../lib/types';

interface CorpusState {
  corpus: Corpus | null;
  dictionary: Dictionary | null;
  loading: boolean;
}

const CorpusContext = createContext<CorpusState | null>(null);

export function CorpusProvider({ children }: { children: ReactNode }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);

  useEffect(() => {
    loadCorpus().then(setCorpus);
    loadDictionary().then(setDictionary);
  }, []);

  const value = useMemo(
    () => ({ corpus, dictionary, loading: !corpus || !dictionary }),
    [corpus, dictionary]
  );
  return <CorpusContext.Provider value={value}>{children}</CorpusContext.Provider>;
}

export function useCorpus() {
  const ctx = useContext(CorpusContext);
  if (!ctx) throw new Error('useCorpus must be used within CorpusProvider');
  return ctx;
}
