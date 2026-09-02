import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useLayout } from '../context/LayoutContext';
import { useUserData } from '../context/UserDataContext';
import { useCorpusSearch } from '../hooks/useCorpusSearch';
import { useActiveHitIndex } from '../hooks/useActiveHitIndex';
import { READER_SEARCH_PLACEHOLDER, SEARCH_NO_MATCHES, SEARCH_RESULTS_CAP } from '../lib/corpus';
import { flattenListTree, suttaRowMeta } from '../lib/lists';
import { MatchedText } from './MatchedText';
import { SuttaRowChips } from './SuttaRowChips';
import { getUiScale } from '../lib/uiPrefs';
import type { ThemeColors } from '../lib/types';

const SAFE_AREA_BOTTOM = 'env(safe-area-inset-bottom, 0px)';

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
  const { mobile } = useLayout();
  const { lists, notes, membership, highlights } = useUserData();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Hover takes the selection over only once the pointer has genuinely moved. Arrow keys scroll the
  // active row into view and typing rebuilds the list, so rows slide under a stationary pointer and
  // the browser fires enter/move events for them anyway.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // Suttas only: this overlay exists to jump elsewhere in the canon without leaving the reader, and
  // a list hit's only destination is the library. Lists surface there instead (SearchListHits).
  const { hits } = useCorpusSearch(corpus, query, notes, lists, highlights);
  // Only render/keyboard-navigate the first SEARCH_RESULTS_CAP — a short/common query can match
  // hundreds of suttas, and every hit is an unvirtualized row in a small scroll panel.
  const displayHits = useMemo(() => hits.slice(0, SEARCH_RESULTS_CAP), [hits]);
  const { activeIndex, setActiveIndex, moveBy, setRowRef } = useActiveHitIndex(query);

  // The same chips and highlight badge as ListPane and TreePane's search results (lib/lists.ts's
  // suttaRowMeta), so a reader-search row is identifiable the same way.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const rowMeta = useMemo(
    () => suttaRowMeta(displayHits.map((h) => h.id), membership, highlights, flatLists),
    [displayHits, membership, highlights, flatLists]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // On touch the panel fills the layout viewport, which the software keyboard doesn't shrink, so
  // the bottom of the results list would sit underneath it. Padding the panel by the keyboard's
  // measured height gives the rows the space that's actually visible, and hands it back when the
  // keyboard goes away. Same treatment as ListMembershipPopover's full-screen sheet.
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
    // Stops here: this modal owns every key while it is up. The reader's window-level keydown
    // handler already bails while the overlay is open (see ReaderPage), but stopping propagation
    // makes that independent of state and timing.
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
      // `search` on iOS puts a Search key on the keyboard, which dismisses it and leaves the
      // results — already filtered as the query was typed — filling the screen.
      enterKeyHint="search"
      className={
        mobile
          ? // WebKit's own clear button is suppressed because the row draws a themed, thumb-sized
            // one beside the field; two of them side by side read as a mistake.
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
      // No backdrop to tap on touch — the panel is the whole screen, so its Cancel button is the
      // way out.
      onClick={mobile ? undefined : onClose}
    >
      {/* Full-screen on touch rather than the desktop floating card: the keyboard takes the lower
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
                onClick={() => onOpenSutta(h.matchedId ?? h.id)}
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
                {/* Why this row is in the results, when nothing visible in it matched. */}
                {!!h.topics?.length && (
                  <span className="block text-ui-sm leading-[1.45] mt-[3px]" style={{ color: theme.dim }}>
                    Indexed under <MatchedText text={h.topics.join(' · ')} query={query} theme={theme} />
                  </span>
                )}
                {(notes[h.id] || h.sutta.blurb) && (
                  <span
                    className={`text-ui-base leading-[1.45] mt-[3px] ${notes[h.id] ? 'pl-[8px] border-l-2 whitespace-pre-wrap' : 'italic'}`}
                    style={{ color: theme.dim, borderColor: notes[h.id] ? theme.rule : undefined }}
                  >
                    <MatchedText text={notes[h.id] || h.sutta.blurb} query={query} theme={theme} notation={!!notes[h.id]} />
                  </span>
                )}
                <SuttaRowChips chips={chips} hlCount={hlCount} hlColors={hlColors} theme={theme} />
              </button>
            );
          })}
          {query.trim() && hits.length === 0 && (
            <div className="font-sans text-center text-ui-base py-8 px-5 text-balance" style={{ color: theme.dim }}>
              {SEARCH_NO_MATCHES}
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
