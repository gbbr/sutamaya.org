import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useLayout } from '../context/LayoutContext';
import { useUserData } from '../context/UserDataContext';
import { useCorpusSearch } from '../hooks/useCorpusSearch';
import { useActiveHitIndex } from '../hooks/useActiveHitIndex';
import { READER_SEARCH_PLACEHOLDER, SEARCH_RESULTS_CAP } from '../lib/search/metadata';
import { searchNoMatches } from '../lib/search/text';
import { beginTextSearchLoad } from '../lib/search/textClient';
import { flattenListTree, suttaRowMeta } from '../lib/lists';
import { MatchedText } from './MatchedText';
import { SuttaRowChips } from './SuttaRowChips';
import { TextSearchProgress } from './TextSearchProgress';
import { getUiScale } from '../lib/uiPrefs';
import type { ThemeColors } from '../lib/types';

const SAFE_AREA_BOTTOM = 'env(safe-area-inset-bottom, 0px)';

interface ReaderSearchOverlayProps {
  theme: ThemeColors;
  // `segment` is where a text hit was found, and where the reader opens; absent for every other row.
  onOpenSutta: (id: string, segments?: [number, number]) => void;
  onClose: () => void;
}

// The reader's search overlay: a floating input with results directly underneath, opened with "/"
// from anywhere in the reader. Each row shows the same blurb and note as ListPane's.
export function ReaderSearchOverlay({ theme, onOpenSutta, onClose }: ReaderSearchOverlayProps) {
  const { corpus } = useCorpus();
  const { mobile } = useLayout();
  const { lists, notes, membership, highlights } = useUserData();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Hover takes the selection over only once the pointer has moved: arrow keys and typing slide
  // rows under a stationary pointer, and the browser fires enter/move events for them anyway.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // Opening this overlay is the reader's equivalent of focusing a search field, so the sutta text
  // starts downloading before anything has been typed.
  useEffect(() => {
    beginTextSearchLoad(corpus);
  }, [corpus]);

  // Suttas only: a list hit's only destination is the library, which is where lists surface.
  const { hits, textStatus, textPending } = useCorpusSearch(corpus, query, notes, lists, highlights);
  // The rows drawn and walked by the arrow keys: the first SEARCH_RESULTS_CAP hits, the panel
  // being unvirtualized.
  const displayHits = useMemo(() => hits.slice(0, SEARCH_RESULTS_CAP), [hits]);
  const { activeIndex, setActiveIndex, moveBy, setRowRef } = useActiveHitIndex(query);

  // The same chips and highlight badge each row carries in ListPane and TreePane.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const rowMeta = useMemo(
    () => suttaRowMeta(displayHits.map((h) => h.id), membership, highlights, flatLists),
    [displayHits, membership, highlights, flatLists]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The height of the software keyboard, which the panel pads itself by on touch: it fills the
  // layout viewport, which the keyboard doesn't shrink, so the last rows would sit underneath it.
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panelRef.current;
    const vv = window.visualViewport;
    if (!el || !mobile || !vv) return;
    const apply = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.paddingBottom = keyboard ? `${keyboard / getUiScale()}px` : SAFE_AREA_BOTTOM;
    };
    apply();
    vv.addEventListener('resize', apply);
    return () => vv.removeEventListener('resize', apply);
  }, [mobile]);

  function onKeyDown(e: React.KeyboardEvent) {
    // Stops here: this modal owns every key while it is up.
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
      onOpenSutta(hit.matchedId ?? hit.id, hit.snippet?.segments);
    }
  }

  const input = (
    <input
      ref={inputRef}
      type="search"
      name="sutamaya-reader-search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={READER_SEARCH_PLACEHOLDER}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      // `search` puts a Search key on the iOS keyboard, which dismisses it and leaves the
      // results filling the screen.
      enterKeyHint="search"
      className={
        mobile
          ? // Suppresses WebKit's own clear button, the row drawing a themed one beside the field.
            'font-sans flex-1 min-w-0 py-2 text-ui-lg outline-none bg-transparent [&::-webkit-search-cancel-button]:hidden'
          : 'font-sans flex-none w-full px-5 py-4 text-ui-lg outline-none bg-transparent'
      }
      style={mobile ? { color: theme.fg } : { color: theme.fg, borderBottom: `1px solid ${theme.rule}` }}
    />
  );

  return (
    <div
      className={
        mobile
          ? 'fixed inset-0 z-50 flex flex-col animate-fadeIn'
          : 'fixed inset-0 z-50 flex justify-center animate-fadeIn'
      }
      style={mobile ? { background: theme.panel } : { background: 'rgba(0,0,0,.35)', paddingTop: '12dvh' }}
      // No backdrop to tap on touch: the panel is the whole screen, and Cancel is the way out.
      onClick={mobile ? undefined : onClose}
    >
      {/* Full-screen on touch rather than the desktop floating card, the keyboard taking the lower
          half of the display, so a card centred in what's left would show two or three results.
          Filling the screen puts the field at the very top and gives every remaining pixel to the
          rows. */}
      <div
        ref={panelRef}
        data-component="ReaderSearchOverlay"
        className={
          mobile
            ? // `touch-none` keeps a drag on the panel's own chrome — the field's row — from
              // scrolling the reading pane it covers; the results opt back in to vertical panning.
              'flex-1 min-h-0 flex flex-col overflow-hidden touch-none'
            : 'w-full mx-4 flex flex-col overflow-hidden rounded-2xl shadow-popup'
        }
        style={
          mobile
            ? {
                background: theme.panel,
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: SAFE_AREA_BOTTOM,
              }
            : { background: theme.panel, maxWidth: 560, maxHeight: '70dvh' }
        }
        onClick={(e) => e.stopPropagation()}
      >
        {mobile ? (
          <div
            className="flex-none flex items-center gap-3 px-4 py-2"
            style={{ borderBottom: `1px solid ${theme.rule}` }}
          >
            <Search size={18} strokeWidth={2} className="flex-none" style={{ color: theme.dim }} />
            {input}
            {query && (
              <button
                className="flex-none flex items-center justify-center w-9 h-9 -mr-1 rounded-full"
                aria-label="Clear search"
                style={{ color: theme.dim }}
                // Keeps focus on the field, so clearing doesn't drop the keyboard the reader is
                // mid-typing on.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
              >
                <X size={18} strokeWidth={2} />
              </button>
            )}
            <button
              className="flex-none font-sans text-ui-base px-1 py-2"
              style={{ color: theme.dim }}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        ) : (
          input
        )}
        <div className="sc flex-1 overflow-y-auto touch-pan-y">
          {displayHits.map((h, i) => {
            const { chips, hlCount, hlColors } = rowMeta.get(h.id) ?? { chips: [], hlCount: 0, hlColors: [] };
            return (
              <button
                key={h.id}
                ref={setRowRef(i)}
                className="row flex flex-col w-full text-left gap-[1px] px-5 py-3"
                style={{
                  background: i === activeIndex ? theme.tint : 'transparent',
                  borderBottom: `1px solid ${theme.rule}`,
                }}
                onMouseMove={(e) => {
                  const prev = lastPointer.current;
                  if (prev && prev.x === e.clientX && prev.y === e.clientY) return;
                  lastPointer.current = { x: e.clientX, y: e.clientY };
                  setActiveIndex(i);
                }}
                onClick={() => onOpenSutta(h.matchedId ?? h.id, h.snippet?.segments)}
              >
                <span>
                  <span className="font-sans text-ui-xs font-bold mr-2.5" style={{ color: theme.dim }}>
                    <MatchedText text={h.sutta.ref} query={query} theme={theme} />
                  </span>
                  <span className="text-ui-lg font-semibold leading-[1.3]">
                    <MatchedText text={h.sutta.en} query={query} theme={theme} />
                  </span>
                </span>
                <span className="font-serif text-ui-base italic" style={{ color: theme.pali }}>
                  <MatchedText text={h.sutta.pali} query={query} theme={theme} />
                </span>
                {h.snippet ? (
                  // Quoted from the sutta: a left rule, which is what marks the sutta's own words
                  // apart from anything written about it.
                  <span
                    className="block font-serif text-ui-base leading-[1.45] mt-[3px] pl-[8px] border-l-2"
                    style={{ color: theme.dim, borderColor: theme.rule }}
                  >
                    {/* No `block` alongside a clamp: the clamp sets `display:-webkit-box` and
                        Tailwind emits it before `.block`, so `block` would silently win. */}
                    <span className="line-clamp-3" style={h.snippet.under ? { color: theme.pali } : undefined}>
                      <MatchedText text={h.snippet.text} query={h.snippet.query} theme={theme} />
                    </span>
                    {h.snippet.under && (
                      <span className="line-clamp-2 mt-[2px]">
                        <MatchedText text={h.snippet.under} query={h.snippet.query} theme={theme} />
                      </span>
                    )}
                  </span>
                ) : notes[h.id] ? (
                  // An em dash rather than a quote rule marks this as the reader's own note.
                  <span className="flex gap-[7px] text-ui-base leading-[1.45] mt-[3px]" style={{ color: theme.dim }}>
                    <span aria-hidden className="flex-none">
                      —
                    </span>
                    <span className="whitespace-pre-wrap">
                      <MatchedText text={notes[h.id]} query={query} theme={theme} notation />
                    </span>
                  </span>
                ) : (
                  h.sutta.blurb && (
                    <span className="text-ui-base leading-[1.45] mt-[3px] italic" style={{ color: theme.dim }}>
                      <MatchedText text={h.sutta.blurb} query={query} theme={theme} />
                    </span>
                  )
                )}
                <SuttaRowChips chips={chips} hlCount={hlCount} hlColors={hlColors} theme={theme} />
              </button>
            );
          })}
          {/* Where the results are, until the sutta text lands and the ranking they wait on with it. */}
          {textPending && <TextSearchProgress theme={theme} />}
          {query.trim() && hits.length === 0 && !textPending && (
            <div className="font-sans text-center text-ui-base py-8 px-5 text-balance" style={{ color: theme.dim }}>
              {searchNoMatches(textStatus)}
            </div>
          )}
          {!query.trim() && (
            <div className="font-sans text-center text-ui-base py-8 px-5" style={{ color: theme.dim }}>
              Type to search the whole corpus.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
