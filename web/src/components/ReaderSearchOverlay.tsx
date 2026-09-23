import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useLayout } from '../context/LayoutContext';
import { useUserData } from '../context/UserDataContext';
import { useCorpusSearch } from '../hooks/useCorpusSearch';
import { useActiveHitIndex } from '../hooks/useActiveHitIndex';
import { useRecentSearches } from '../hooks/useRecentSearches';
import { READER_SEARCH_PLACEHOLDER, SEARCH_CAP_NOTE, SEARCH_RESULTS_CAP, type SearchHit } from '../lib/search/metadata';
import { clearRecentSearches, removeRecentSearch, saveRecentSearch } from '../lib/recentSearches';
import { searchNoMatches } from '../lib/search/text';
import { beginTextSearchLoad } from '../lib/search/textClient';
import { prefetchSuttaText } from '../lib/suttaPrefetch';
import { flattenListTree, suttaRowMeta } from '../lib/lists';
import { MatchedText } from './MatchedText';
import { RecentSearches } from './RecentSearches';
import { SuttaRowChips } from './SuttaRowChips';
import { TextSearchProgress } from './TextSearchProgress';
import { SearchUpdating } from './SearchUpdating';
import { getUiScale } from '../lib/uiPrefs';
import type { ThemeColors } from '../lib/types';

const SAFE_AREA_BOTTOM = 'var(--safe-bottom)';

// The wash on the row under the cursor: half the strength of the selection tint the panes use,
// since here it sits on a panel over the reading itself and marks a cursor rather than a choice.
const ROW_TINT = (tint: string) => `color-mix(in srgb, ${tint} 50%, transparent)`;

// The colour of a description or a quoted passage: halfway between the body text and `dim`.
const PROSE_COLOR = (theme: ThemeColors) => `color-mix(in srgb, ${theme.fg}, ${theme.dim})`;

// Passages of the sutta being read shown before "more".
const PASSAGES_SHOWN = 1;
// Passages each "more" adds.
const PASSAGES_STEP = 10;

// How the overlay was left, which it reopens as while the same sutta is on screen.
export interface ReaderSearchView {
  query: string;
  // Passages of the sutta being read shown.
  shown: number;
  scrollTop: number;
  activeIndex: number;
}

// A passage of sutta text holding the query, as a row quotes it.
type Passage = NonNullable<SearchHit['snippet']>;

// SnippetQuote draws a passage quoted from a sutta, under the left rule that sets the sutta's own
// words apart from anything written about it.
function SnippetQuote({ snippet, theme }: { snippet: Passage; theme: ThemeColors }) {
  return (
    <span
      className="block font-serif text-ui-base leading-[1.45] mt-[3px] pl-[8px] border-l-2"
      style={{ color: PROSE_COLOR(theme), borderColor: theme.rule }}
    >
      {/* No `block` alongside a clamp: the clamp sets `display:-webkit-box` and
          Tailwind emits it before `.block`, so `block` would silently win. */}
      <span className="line-clamp-3" style={snippet.under ? { color: theme.pali } : undefined}>
        <MatchedText text={snippet.text} query={snippet.query} theme={theme} />
      </span>
      {snippet.under && (
        <span className="line-clamp-2 mt-[2px]">
          <MatchedText text={snippet.under} query={snippet.query} theme={theme} />
        </span>
      )}
    </span>
  );
}

// SectionHeading heads one kind of result, as the Library's search does.
function SectionHeading({ children, theme }: { children: React.ReactNode; theme: ThemeColors }) {
  return (
    <div
      className="px-5 pt-3 pb-1.5 font-sans text-ui-2xs font-bold tracking-[.12em] uppercase"
      style={{ color: theme.dim }}
    >
      {children}
    </div>
  );
}

interface ReaderSearchOverlayProps {
  theme: ThemeColors;
  // The sutta on screen, whose passages holding the query lead the results.
  currentId?: string;
  // How the overlay was last left, kept up to date while it is open; null starts it afresh.
  saved: { current: ReaderSearchView | null };
  // `segment` is where a text hit was found, and where the reader opens; absent for every other row.
  onOpenSutta: (id: string, segments?: [number, number]) => void;
  onClose: () => void;
}

// The reader's search overlay: a floating input with results directly underneath, opened with "/"
// from anywhere in the reader. Each row shows the same blurb and note as ListPane's.
export function ReaderSearchOverlay({ theme, currentId, saved, onOpenSutta, onClose }: ReaderSearchOverlayProps) {
  const { corpus } = useCorpus();
  const { mobile } = useLayout();
  const { lists, notes, membership, highlights } = useUserData();
  // How the overlay was left, as it opens.
  const [resumed] = useState(() => saved.current);
  const [query, setQuery] = useState(resumed?.query ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Hover takes the selection over only once the pointer has moved: arrow keys and typing slide
  // rows under a stationary pointer, and the browser fires enter/move events for them anyway.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // Opening this overlay is the reader's equivalent of focusing a search field, so the sutta text
  // starts downloading before anything has been typed.
  useEffect(() => {
    beginTextSearchLoad(corpus);
  }, [corpus]);

  // Suttas only: a list hit's only destination is the library, which is where lists surface.
  const { hits, textStatus, textPending, hitsSettled, updating } = useCorpusSearch(
    corpus,
    query,
    notes,
    lists,
    highlights,
    currentId
  );
  // The passages of the sutta being read that hold the query, and the other suttas' hits: the first
  // SEARCH_RESULTS_CAP of them, the panel being unvirtualized.
  const { passages, displayHits, othersTotal } = useMemo(() => {
    const reading = hits.find((h) => h.id === currentId && h.passages?.length);
    const others = reading ? hits.filter((h) => h !== reading) : hits;
    return {
      passages: reading?.passages ?? [],
      displayHits: others.slice(0, SEARCH_RESULTS_CAP),
      othersTotal: others.length,
    };
  }, [hits, currentId]);
  // How many passages are shown, and the query they were counted on.
  const [shown, setShown] = useState({ query, count: resumed?.shown ?? PASSAGES_SHOWN });
  const shownCount = shown.query === query ? shown.count : PASSAGES_SHOWN;
  const shownPassages = passages.slice(0, Math.min(shownCount, SEARCH_RESULTS_CAP));
  // Passages "more" can still show, up to the cap.
  const hiddenPassages = Math.min(passages.length, SEARCH_RESULTS_CAP) - shownPassages.length;
  // The rows walked by the arrow keys: the passages shown, then the other suttas.
  const rowCount = shownPassages.length + displayHits.length;
  const { activeIndex, setActiveIndex, moveBy, setRowRef } = useActiveHitIndex(query);

  // The row the overlay was left on, over the cursor's reset to the first.
  useEffect(() => {
    if (resumed) setActiveIndex(resumed.activeIndex);
  }, [resumed, setActiveIndex]);
  // The scroll it was left at, once the rows it was measured over are back.
  const scrollPending = useRef(!!resumed);
  useLayoutEffect(() => {
    if (!scrollPending.current || !hitsSettled) return;
    scrollPending.current = false;
    if (resumed && resultsRef.current) resultsRef.current.scrollTop = resumed.scrollTop;
  }, [resumed, hitsSettled]);
  // A new query opens at the top, as ListPane's does; not the query the overlay reopened on.
  const scrolledQuery = useRef(query.trim());
  useEffect(() => {
    const q = query.trim();
    if (q === scrolledQuery.current) return;
    scrolledQuery.current = q;
    scrollPending.current = false;
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [query]);
  // The overlay as it stands, for the next time it opens.
  useEffect(() => {
    saved.current = { query, shown: shownCount, activeIndex, scrollTop: saved.current?.scrollTop ?? 0 };
  }, [saved, query, shownCount, activeIndex]);
  const searches = useRecentSearches();
  // The recent searches, in place of the prompt while the box is empty.
  const showRecent = !query.trim() && searches.length > 0;
  // Their cursor, which starts on no row.
  const {
    activeIndex: recentIndex,
    setActiveIndex: setRecentIndex,
    moveBy: moveRecentBy,
    setRowRef: setRecentRowRef,
  } = useActiveHitIndex(query, -1);

  // pointerMoved reports whether the pointer moved, rather than a row sliding under a still one.
  function pointerMoved(e: React.MouseEvent): boolean {
    const prev = lastPointer.current;
    if (prev && prev.x === e.clientX && prev.y === e.clientY) return false;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    return true;
  }

  function openHit(hit: SearchHit) {
    // Reopening the sutta already open isn't kept as a search.
    if (hit.id !== currentId) saveRecentSearch(query);
    onOpenSutta(hit.matchedId ?? hit.id, hit.snippet?.segments);
  }

  // openPassage scrolls the sutta being read to one of its passages.
  function openPassage(passage: Passage) {
    if (currentId) onOpenSutta(currentId, passage.segments);
  }

  // openRow opens the row at `i` of the ones the arrow keys walk, and keeps it as the row the
  // overlay reopens on.
  function openRow(i: number) {
    if (saved.current) saved.current.activeIndex = i;
    if (i < shownPassages.length) openPassage(shownPassages[i]);
    else if (displayHits[i - shownPassages.length]) openHit(displayHits[i - shownPassages.length]);
  }

  // pickRecent runs a recent search again, closing a touch screen's keyboard.
  function pickRecent(q: string) {
    setQuery(q);
    if (window.matchMedia?.('(pointer: coarse)').matches) inputRef.current?.blur();
    else inputRef.current?.focus();
  }

  // The same chips and highlight badge each row carries in ListPane and TreePane.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const rowMeta = useMemo(
    () => suttaRowMeta(displayHits.map((h) => h.id), membership, highlights, flatLists),
    [displayHits, membership, highlights, flatLists]
  );

  // Focused with the last query selected, so typing replaces it. A touch screen reopening on a
  // query leaves the field alone, keeping the keyboard off the results being returned to.
  useEffect(() => {
    if (resumed?.query.trim() && window.matchMedia?.('(pointer: coarse)').matches) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [resumed]);

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
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      if (showRecent) moveRecentBy(delta, searches.length);
      else moveBy(delta, rowCount);
    } else if (e.key === 'Enter') {
      const recent = showRecent ? searches[recentIndex] : undefined;
      if (recent) {
        e.preventDefault();
        pickRecent(recent);
      } else if (activeIndex >= 0 && activeIndex < rowCount) {
        e.preventDefault();
        openRow(activeIndex);
      }
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
      style={mobile ? { background: theme.overlay ?? theme.panel } : { background: 'rgba(0,0,0,.35)', paddingTop: '12dvh' }}
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
                background: theme.overlay ?? theme.panel,
                paddingTop: 'var(--safe-top)',
                paddingBottom: SAFE_AREA_BOTTOM,
              }
            : { background: theme.overlay ?? theme.panel, maxWidth: 560, maxHeight: '70dvh' }
        }
        onClick={(e) => e.stopPropagation()}
      >
        {mobile ? (
          <div
            className="flex-none flex items-center gap-3 px-4 py-2"
            style={{ borderBottom: `1px solid ${theme.rule}` }}
          >
            {/* The field's own glyph, which becomes the spinner while the rows below are the
                previous answer and a newer one is being scanned. Boxed to the glyph's width, so
                the field doesn't shift when the two swap. */}
            <span className="flex-none w-[18px] flex items-center justify-center">
              {updating ? (
                <SearchUpdating theme={theme} />
              ) : (
                <Search size={18} strokeWidth={2} style={{ color: theme.dim }} />
              )}
            </span>
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
          // Relative for the spinner, which sits in the field's trailing edge while the rows below
          // are the previous answer and a newer one is being scanned.
          <div className="relative flex-none">
            {input}
            {updating && (
              <span className="absolute right-5 top-1/2 -translate-y-1/2">
                <SearchUpdating theme={theme} />
              </span>
            )}
          </div>
        )}
        <div
          ref={resultsRef}
          className="sc flex-1 overflow-y-auto touch-pan-y"
          aria-busy={updating}
          onScroll={(e) => {
            if (saved.current) saved.current.scrollTop = e.currentTarget.scrollTop;
          }}
        >
          {passages.length > 0 && (
            <>
              <SectionHeading theme={theme}>
                In this sutta ({passages.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+` : passages.length})
              </SectionHeading>
              {shownPassages.map((p, i) => (
                <button
                  key={p.segments.join('-')}
                  ref={setRowRef(i)}
                  className="row flex flex-col w-full text-left px-5 pt-2 pb-3"
                  style={{
                    background: i === activeIndex ? ROW_TINT(theme.tint) : 'transparent',
                    // The last row runs straight into the toggle beneath it.
                    borderBottom:
                      i === shownPassages.length - 1 && passages.length > PASSAGES_SHOWN
                        ? undefined
                        : `1px solid ${theme.rule}`,
                  }}
                  onMouseMove={(e) => {
                    if (pointerMoved(e)) setActiveIndex(i);
                  }}
                  onClick={() => openRow(i)}
                >
                  <SnippetQuote snippet={p} theme={theme} />
                </button>
              ))}
              {hiddenPassages === 0 && passages.length > SEARCH_RESULTS_CAP && (
                <div className="font-sans text-center text-ui-sm py-6 px-5 text-balance" style={{ color: theme.dim }}>
                  {SEARCH_CAP_NOTE}
                </div>
              )}
              {passages.length > PASSAGES_SHOWN && (
                <button
                  className="flex items-center gap-1 w-full px-5 pt-2 pb-2.5 font-sans text-ui-xs font-semibold"
                  style={{ color: theme.dim, borderBottom: `1px solid ${theme.rule}` }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    setShown({ query, count: hiddenPassages > 0 ? shownPassages.length + PASSAGES_STEP : PASSAGES_SHOWN })
                  }
                >
                  {hiddenPassages > 0 ? `${Math.min(PASSAGES_STEP, hiddenPassages)} more` : 'Fewer'}
                  <ChevronDown
                    size={14}
                    strokeWidth={2.25}
                    className={`flex-none transition-transform ${hiddenPassages > 0 ? '' : 'rotate-180'}`}
                  />
                </button>
              )}
              {displayHits.length > 0 && (
                <SectionHeading theme={theme}>
                  Other suttas ({othersTotal > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+` : othersTotal})
                </SectionHeading>
              )}
            </>
          )}
          {displayHits.map((h, j) => {
            const i = shownPassages.length + j;
            const { chips, hlCount, hlColors } = rowMeta.get(h.id) ?? { chips: [], hlCount: 0, hlColors: [] };
            const note = notes[h.id];
            // The line that carried the query leads the quote from the sutta — see ListPane.
            const explains = h.explains;
            const showNote = !!note && (explains?.line === 'note' || (!h.snippet && explains?.line !== 'blurb'));
            const showBlurb = !showNote && !!h.sutta.blurb && (explains?.line === 'blurb' || !h.snippet);
            const lineQuery = (line: 'note' | 'blurb') => (explains?.line === line ? explains.query : query);
            return (
              <button
                key={h.id}
                ref={setRowRef(i)}
                className="row flex flex-col w-full text-left gap-[1px] px-5 py-3"
                style={{
                  background: i === activeIndex ? ROW_TINT(theme.tint) : 'transparent',
                  borderBottom: `1px solid ${theme.rule}`,
                }}
                onMouseMove={(e) => {
                  if (pointerMoved(e)) setActiveIndex(i);
                }}
                onClick={() => openRow(i)}
                // The press starts the text load, so the reader has it in hand when the hit opens.
                onPointerDown={() => prefetchSuttaText(corpus, h.matchedId ?? h.id)}
              >
                <span>
                  <span className="font-sans text-ui-xs font-bold mr-2.5" style={{ color: theme.dim }}>
                    <MatchedText text={h.sutta.ref} query={query} theme={theme} />
                  </span>
                  {h.id === currentId && (
                    // Marks the sutta already open.
                    <span
                      className="inline-block w-[6px] h-[6px] rounded-full mr-2 align-[0.15em]"
                      style={{ background: theme.pali }}
                      role="img"
                      aria-label="The sutta you're reading"
                      title="The sutta you're reading"
                    />
                  )}
                  <span className="text-ui-lg font-semibold leading-[1.3]">
                    <MatchedText text={h.sutta.en} query={query} theme={theme} />
                  </span>
                </span>
                <span className="font-serif text-ui-base italic" style={{ color: theme.pali }}>
                  <MatchedText text={h.sutta.pali} query={query} theme={theme} />
                </span>
                {showNote && (
                  // An em dash rather than a quote rule marks this as the reader's own note.
                  <span className="flex gap-[7px] text-ui-base leading-[1.45] mt-[3px]" style={{ color: theme.dim }}>
                    <span aria-hidden className="flex-none">
                      —
                    </span>
                    <span className="whitespace-pre-wrap">
                      <MatchedText text={note} query={lineQuery('note')} theme={theme} notation />
                    </span>
                  </span>
                )}
                {showBlurb && (
                  <span className="text-ui-base leading-[1.45] mt-[3px]" style={{ color: PROSE_COLOR(theme) }}>
                    <MatchedText text={h.sutta.blurb} query={lineQuery('blurb')} theme={theme} />
                  </span>
                )}
                {h.snippet && <SnippetQuote snippet={h.snippet} theme={theme} />}
                <SuttaRowChips chips={chips} hlCount={hlCount} hlColors={hlColors} theme={theme} query={query} />
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
          {showRecent ? (
            <RecentSearches
              searches={searches}
              activeIndex={recentIndex}
              onPick={pickRecent}
              onRemove={removeRecentSearch}
              onClear={clearRecentSearches}
              setRowRef={setRecentRowRef}
              onHover={(i, e) => {
                if (pointerMoved(e)) setRecentIndex(i);
              }}
              inset={20}
              theme={theme}
            />
          ) : (
            !query.trim() && (
              <div className="font-sans text-center text-ui-base py-8 px-5" style={{ color: theme.dim }}>
                Type to search the whole corpus.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
