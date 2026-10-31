import { useEffect, useState, type RefObject } from 'react';
import { READER_TIP_KEY } from '../lib/storageKeys';
import { usePersistedState } from './usePersistedState';

interface UseReaderTipOptions {
  suttaId: string | undefined;
  scrollRef: RefObject<HTMLElement | null>;
  // True while the sutta's text is on screen, loaded and not held back for its place.
  textShown: boolean;
  paliShowing: boolean;
  dictOpen: boolean;
}

/**
 * Tracks the reader's first-run tip on this device, returning whether it shows, whether its first
 * step is ticked, and a way to close it. Showing any Pali ticks the first step; the first dictionary
 * lookup, or closing it, retires it for good.
 */
export function useReaderTip({ suttaId, scrollRef, textShown, paliShowing, dictOpen }: UseReaderTipOptions) {
  const [progress, setProgress] = usePersistedState(READER_TIP_KEY, { pali: false, done: false });
  // The sutta whose text the reader has reached: its first line scrolled up into the top quarter of
  // the pane.
  const [reachedIn, setReachedIn] = useState<string | null>(null);

  useEffect(() => {
    if (progress.done) return;
    if (dictOpen) setProgress((p) => ({ ...p, done: true }));
    else if (paliShowing && !progress.pali) setProgress((p) => ({ ...p, pali: true }));
  }, [dictOpen, paliShowing, progress, setProgress]);

  useEffect(() => {
    const pane = scrollRef.current;
    if (progress.done || !textShown || !suttaId || reachedIn === suttaId || !pane) return;
    const id = suttaId;
    const check = () => {
      const first = pane.querySelector('[data-seg]');
      if (!first) return;
      const paneRect = pane.getBoundingClientRect();
      if (first.getBoundingClientRect().top - paneRect.top <= paneRect.height / 4) setReachedIn(id);
    };
    check();
    pane.addEventListener('scroll', check, { passive: true });
    return () => pane.removeEventListener('scroll', check);
  }, [progress.done, textShown, suttaId, reachedIn, scrollRef]);

  return {
    visible: !progress.done && !dictOpen && textShown && reachedIn === suttaId,
    paliDone: progress.pali,
    close: () => setProgress((p) => ({ ...p, done: true })),
  };
}
