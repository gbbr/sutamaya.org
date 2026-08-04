import { useEffect, useRef, useState } from 'react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { searchCorpus } from '../lib/corpus';
import type { ThemeColors } from '../lib/types';

interface ReaderSearchOverlayProps {
  theme: ThemeColors;
  onOpenSutta: (id: string) => void;
  onClose: () => void;
}

// Alfred/Spotlight-style: a floating input with results directly underneath, no per-row blurb
// ("no blob") — just enough (ref, title, Pali) to pick the right sutta and jump straight to it,
// triggered by "/" from anywhere in the reader (see the keydown handler in ReaderPage.tsx).
export function ReaderSearchOverlay({ theme, onOpenSutta, onClose }: ReaderSearchOverlayProps) {
  const { corpus } = useCorpus();
  const { notes } = useUserData();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const hits = corpus && query.trim() ? searchCorpus(corpus, query, notes) : [];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && hits[activeIndex]) {
      e.preventDefault();
      onOpenSutta(hits[activeIndex].id);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center animate-fadeIn"
      style={{ background: 'rgba(0,0,0,.35)', paddingTop: '12vh' }}
      onClick={onClose}
    >
      <div
        className="w-full mx-4 flex flex-col overflow-hidden rounded-2xl shadow-popup"
        style={{ background: theme.panel, maxWidth: 560, maxHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="search"
          name="sutamaya-reader-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search ID, title, blurb, note, text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="font-sans flex-none w-full px-5 py-4 text-[16px] outline-none bg-transparent"
          style={{ color: theme.fg, borderBottom: `1px solid ${theme.rule}` }}
        />
        <div className="sc flex-1 overflow-y-auto">
          {hits.map((h, i) => (
            <button
              key={h.id}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className="row flex flex-col w-full text-left gap-[1px] px-5 py-3"
              style={{
                background: i === activeIndex ? theme.rule : 'transparent',
                borderBottom: `1px solid ${theme.rule}`,
              }}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onOpenSutta(h.id)}
            >
              <span>
                <span className="font-sans text-[11.5px] font-bold mr-2.5" style={{ color: theme.dim }}>
                  {h.sutta.ref}
                </span>
                <span className="text-[15.5px] font-semibold leading-[1.3]">{h.sutta.en}</span>
              </span>
              <span className="font-serif text-[13px] italic" style={{ color: theme.pali }}>
                {h.sutta.pali}
              </span>
            </button>
          ))}
          {query.trim() && hits.length === 0 && (
            <div className="font-sans text-center text-[13px] py-8 px-5" style={{ color: theme.dim }}>
              No matches.
            </div>
          )}
          {!query.trim() && (
            <div className="font-sans text-center text-[13px] py-8 px-5" style={{ color: theme.dim }}>
              Type to search the whole corpus.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
