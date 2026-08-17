import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadCorpus, loadDictionary } from '../lib/corpus';
import { retryWithBackoff } from '../lib/retry';
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
  // Re-attempts a dictionary load that has already failed, no-op otherwise — for a caller that
  // has just independently confirmed the dictionary is now reachable (e.g. SettingsPage's "download
  // all suttas for offline" successfully caching dictionary.json) and wants the in-memory
  // `dictionary` above to actually pick it up, rather than sitting stuck until an unrelated
  // 'online'/visibilitychange event happens to fire.
  retryDictionary: () => void;
}

const CorpusContext = createContext<CorpusState | null>(null);

export function CorpusProvider({ children }: { children: ReactNode }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dictionaryAttempt, setDictionaryAttempt] = useState(0);

  useEffect(() => {
    setError(false);
    loadCorpus()
      .then(setCorpus)
      .catch((e) => {
        console.error('Failed to load corpus', e);
        setError(true);
      });
  }, [attempt]);

  // Its own effect (not the corpus one above) so a dictionary retry doesn't also re-fetch
  // corpus.json, and vice versa. retryWithBackoff (lib/retry.ts) absorbs a flaky-network blip on
  // its own; the online/visibilitychange listeners below cover the case that used to leave this
  // stuck — the device was genuinely offline and every backoff attempt failed — which left
  // `dictionary` null forever (DictionaryDock stuck on "Loading dictionary…") with no way out
  // short of restarting the whole app, since nothing here ever tried again. `failedRef` (not just
  // "dictionary is still null") is what the listeners below check, so a stray event firing while
  // an attempt is genuinely still in flight — plausible right at a cold PWA launch — can't spawn a
  // second, redundant Worker+fetch racing the first one; it's only set once every backoff attempt
  // has actually been exhausted.
  const dictionaryFailedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    // Cleared up front, not just on success — false for the *whole* attempt (including its own
    // backoff retries inside retryWithBackoff), not only once it has already succeeded. Clearing
    // it solely in the .then() left it true for the several seconds an attempt spends retrying
    // internally, so a second online/visibilitychange event landing in that window would still
    // read "failed" and fire yet another concurrent attempt on top of the one already running.
    dictionaryFailedRef.current = false;
    retryWithBackoff(loadDictionary)
      .then((d) => {
        if (!cancelled) setDictionary(d);
      })
      .catch((e) => {
        console.error('Failed to load dictionary', e);
        if (!cancelled) dictionaryFailedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [dictionaryAttempt]);

  // Shared by the online/visibilitychange listeners below, the manual `retry`, and the
  // externally-exposed `retryDictionary` — the one place that actually decides whether a retry is
  // warranted (gated on dictionaryFailedRef, so calling it when nothing has failed, or while an
  // attempt is already in flight, is a safe no-op rather than an extra concurrent fetch).
  const retryDictionaryIfFailed = useMemo(
    () => () => {
      if (dictionaryFailedRef.current) setDictionaryAttempt((n) => n + 1);
    },
    []
  );

  // Fires a fresh dictionary attempt once connectivity is plausibly back — 'online', or the app
  // becoming visible again (a PWA relaunch or tab switch after being offline doesn't reliably fire
  // 'online' on its own).
  useEffect(() => {
    function onConnectivityChange() {
      if (document.visibilityState !== 'hidden') retryDictionaryIfFailed();
    }
    window.addEventListener('online', onConnectivityChange);
    document.addEventListener('visibilitychange', onConnectivityChange);
    return () => {
      window.removeEventListener('online', onConnectivityChange);
      document.removeEventListener('visibilitychange', onConnectivityChange);
    };
  }, [retryDictionaryIfFailed]);

  // Also retries the dictionary, not just corpus.json — a manual retry click is a strong "I'm
  // back online" signal in its own right, and shouldn't leave a still-failed dictionary waiting on
  // a separate browser event that may already have fired before the user noticed the error.
  const retry = useMemo(
    () => () => {
      setAttempt((n) => n + 1);
      retryDictionaryIfFailed();
    },
    [retryDictionaryIfFailed]
  );

  // Only `corpus` gates first paint — it's a few MB and is all the browse tree/reader need to
  // render. `dictionary` (~20MB, loaded off-thread — see loadDictionary()) keeps loading in the
  // background; its only consumer (ReaderPage's word-tap lookup) already null-checks it.
  const value = useMemo(
    () => ({ corpus, dictionary, loading: !corpus && !error, error, retry, retryDictionary: retryDictionaryIfFailed }),
    [corpus, dictionary, error, retry, retryDictionaryIfFailed]
  );
  return <CorpusContext.Provider value={value}>{children}</CorpusContext.Provider>;
}

export function useCorpus() {
  const ctx = useContext(CorpusContext);
  if (!ctx) throw new Error('useCorpus must be used within CorpusProvider');
  return ctx;
}
