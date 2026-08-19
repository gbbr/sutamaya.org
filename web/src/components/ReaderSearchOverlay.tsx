import { useEffect, useMemo, useRef, useState } from 'react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useCorpusSearch } from '../hooks/useCorpusSearch';
import { useActiveHitIndex } from '../hooks/useActiveHitIndex';
import { SEARCH_PLACEHOLDER, SEARCH_RESULTS_CAP } from '../lib/corpus';
import { flattenListTree, suttaRowMeta } from '../lib/lists';
import { SuttaRowChips } from './SuttaRowChips';
import type { ThemeColors } from '../lib/types';

interface ReaderSearchOverlayProps {
  theme: ThemeColors;
  onOpenSutta: (id: string) => void;
  onClose: () => void;
}

// Alfred/Spotlight-style: a floating input with results directly underneath, triggered by "/"
// from anywhere in the reader (see the keydown handler in ReaderPage.tsx). Each row shows the
// same blurb/note as ListPane, so results are identifiable without opening them.
export function ReaderSearchOverlay({ theme, onOpenSutta, onClose }: ReaderSearchOverlayProps) {
  const { corpus } = useCorpus();
  const { lists, notes, membership, highlights } = useUserData();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useCorpusSearch(corpus, query, notes, lists);
  // Only render/keyboard-navigate the first SEARCH_RESULTS_CAP — a short/common query can match
  // hundreds of suttas, and every hit is an unvirtualized row in a small scroll panel.
  const displayHits = useMemo(() => hits.slice(0, SEARCH_RESULTS_CAP), [hits]);
  const { activeIndex, setActiveIndex, moveBy, setRowRef } = useActiveHitIndex(query);

  // Same list-membership chips + highlight-count badge as ListPane/TreePane's own search results
  // (see lib/lists.ts's suttaRowMeta), so a reader-search row is identifiable the same way.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const rowMeta = useMemo(
    () => suttaRowMeta(displayHits.map((h) => h.id), membership, highlights, flatLists),
    [displayHits, membership, highlights, flatLists]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    // Stops here — the reader's own window-level keydown handler already bails while this
    // overlay is open (see ReaderPage), but stopping propagation outright means that doesn't
    // depend on state/timing at all: this modal owns every key while it's up, full stop.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveBy(1, displayHits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveBy(-1, displayHits.length);
    } else if (e.key === 'Enter' && displayHits[activeIndex]) {
      e.preventDefault();
      const hit = displayHits[activeIndex];
      onOpenSutta(hit.matchedId ?? hit.id);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center animate-fadeIn"
      // Not `vh` — see index.css's --app-height comment for why some WebView builds don't
      // recompute it correctly after applyUiScale's viewport-meta path changes the page's scale.
      style={{ background: 'rgba(0,0,0,.35)', paddingTop: 'calc(var(--app-height, 100vh) * 0.12)' }}
      onClick={onClose}
    >
      <div
        data-component="ReaderSearchOverlay"
        className="w-full mx-4 flex flex-col overflow-hidden rounded-2xl shadow-popup"
        style={{ background: theme.panel, maxWidth: 560, maxHeight: 'calc(var(--app-height, 100vh) * 0.70)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="search"
          name="sutamaya-reader-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={SEARCH_PLACEHOLDER}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-sans flex-none w-full px-5 py-4 text-[16px] outline-none bg-transparent"
          style={{ color: theme.fg, borderBottom: `1px solid ${theme.rule}` }}
        />
        <div className="sc flex-1 overflow-y-auto">
          {displayHits.map((h, i) => {
            const { chips, hlCount } = rowMeta.get(h.id) ?? { chips: [], hlCount: 0 };
            return (
              <button
                key={h.id}
                ref={setRowRef(i)}
                className="row flex flex-col w-full text-left gap-[1px] px-5 py-3"
                style={{
                  background: i === activeIndex ? theme.tint : 'transparent',
                  borderBottom: `1px solid ${theme.rule}`,
                }}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => onOpenSutta(h.matchedId ?? h.id)}
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
                {(notes[h.id] || h.sutta.blurb) && (
                  <span
                    className={`text-[13px] leading-[1.45] mt-[3px] ${notes[h.id] ? 'pl-[8px] border-l-2' : 'italic'}`}
                    style={{ color: theme.dim, borderColor: notes[h.id] ? theme.rule : undefined }}
                  >
                    {notes[h.id] || h.sutta.blurb}
                  </span>
                )}
                <SuttaRowChips chips={chips} hlCount={hlCount} theme={theme} />
              </button>
            );
          })}
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
