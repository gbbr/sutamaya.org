import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpDown, Check, GripVertical } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { usePointerDragSession } from '../hooks/usePointerDragSession';
import { listItemsFor, nodeLabel, SEARCH_RESULTS_CAP, type SearchHit } from '../lib/corpus';
import { highlightCount } from '../lib/highlights';
import { flattenListTree, resolveListById } from '../lib/lists';
import { AUTO_LIST_IDS } from '../lib/autoLists';
import { HighlightCountBadge } from './HighlightCountBadge';
import type { Sutta } from '../lib/types';

interface ListPaneProps {
  nodeId?: string;
  selectedId?: string;
  query: string;
  // Search hits, computed once by LibraryPage and shared with TreePane — see TreePane for why
  // (avoids both panes independently running the same scan, and is what lets this pane be the
  // one place results actually render on desktop).
  hits: SearchHit[];
  // The hit TreePane's own arrow-key nav currently has highlighted, while searching — mirrored
  // onto that same row here so the keyboard-driven highlight is visible even though this pane
  // (not TreePane) is the one showing the row on desktop.
  activeId?: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
}

export function ListPane({ nodeId, selectedId, query, hits, activeId, onBack, onOpen, visible = true }: ListPaneProps) {
  const { corpus } = useCorpus();
  const { lists, membership, notes, highlights, visited, reorderListItems } = useUserData();
  const { mobile } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>(`list:${query.trim() ? 'search' : nodeId || 'none'}`, visible);
  const itemRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const searching = query.trim().length > 0;
  const currentList = !searching ? lists.find((l) => String(l.id) === nodeId) : undefined;
  // "Highlights"/"Notes" membership is redundant here — a row already shows note text and
  // highlight-count circles directly, so the auto lists never appear as chips.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);

  // A short/common query can match hundreds of suttas (see SEARCH_RESULTS_CAP's own comment) —
  // rendered rows are capped the same way TreePane's own search list is, while `hits.length`
  // (uncapped) still drives the "N results" count below so it stays honest.
  const items = useMemo(
    () =>
      corpus
        ? searching
          ? hits.slice(0, SEARCH_RESULTS_CAP).map(({ id, sutta }) => [id, sutta] as [string, Sutta])
          : listItemsFor(corpus, nodeId, lists)
        : [],
    [corpus, nodeId, lists, searching, hits]
  );

  // Chips/highlight-count per row, keyed off `items` rather than the reorder-drag's own
  // `displayItems` — `items` (and therefore this map) doesn't change while a drag reshuffles
  // display order, so dragging a list no longer recomputes every visible row's chip/highlight
  // lookups on every rAF tick, just the moved row's position.
  const rowMeta = useMemo(() => {
    const map = new Map<string, { chips: Array<{ id: string; breadcrumb: string }>; hlCount: number }>();
    for (const [id] of items) {
      const chips = (membership[id] || [])
        .filter((c) => !AUTO_LIST_IDS.has(c))
        .map((c) => ({ id: c, breadcrumb: resolveListById(c, flatLists).breadcrumb }));
      map.set(id, { chips, hlCount: highlightCount(highlights[id] || []) });
    }
    return map;
  }, [items, membership, flatLists, highlights]);

  // Pointer Events (not HTML5 drag-and-drop, which touch browsers largely don't fire) drive a
  // single-list drag-reorder: the dragged item's id and a live working copy of the order live in
  // refs/state here, `dragOrder` (rendered instead of `items` while set) shifts live as the
  // pointer crosses row midpoints. The window-listener/rAF/auto-scroll plumbing itself is shared
  // with TreePane's list-tree drag via usePointerDragSession, which keeps re-evaluating the drop
  // target whenever the pointer sits inside the top/bottom edge band, so it also reorders
  // correctly if content scrolls under a stationary finger.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // Off by default — the drag handles take up space every row would otherwise get, so they only
  // show once explicitly requested via the header toggle (mirrors TreePane's own reorder-mode
  // toggle for the list tree).
  const [reorderMode, setReorderMode] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  // Mirrors `dragOrder` so endDrag can read the live value. The window-level `onUp` listener
  // that calls endDrag is registered once, at drag-start, so the `endDrag` closure it holds is
  // fixed to that render — reading the `dragOrder` *state* there would see whatever it was back
  // at drag-start (null), not the live in-progress order; a ref isn't tied to any one render.
  const dragOrderRef = useRef<string[] | null>(null);

  const displayItems: Array<[string, Sutta]> =
    dragOrder && corpus
      ? dragOrder.flatMap((id) => (corpus.suttas[id] ? [[id, corpus.suttas[id]] as [string, Sutta]] : []))
      : items;

  function updateDragTarget(y: number) {
    const id = dragIdRef.current;
    if (!id) return;
    setDragOrder((order) => {
      if (!order) return order;
      const mids = order
        .map((itemId) => {
          const el = itemRowRefs.current.get(itemId);
          return el ? { itemId, mid: el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 } : null;
        })
        .filter((x): x is { itemId: string; mid: number } => !!x);
      let targetIndex = mids.length;
      for (let i = 0; i < mids.length; i++) {
        if (y < mids[i].mid) {
          targetIndex = i;
          break;
        }
      }
      const currentIndex = order.indexOf(id);
      if (currentIndex === -1) return order;
      const insertAt = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
      if (insertAt === currentIndex) return order;
      const next = order.filter((x) => x !== id);
      next.splice(insertAt, 0, id);
      dragOrderRef.current = next;
      return next;
    });
  }

  const dragSession = usePointerDragSession({ scrollRef, onFrame: updateDragTarget });

  function endDrag() {
    // Idempotent — a no-op if the session already tore itself down on pointerup, but also the
    // only teardown path when this is called from a bail-out (nodeId change/unmount) rather than
    // a real pointerup.
    dragSession.cancel();
    dragIdRef.current = null;
    // Read the live value via the ref (see dragOrderRef's comment above) rather than committing
    // inside setDragOrder's updater — an updater must be pure, and reorderListItems triggers a
    // *different* component's setState (UserDataContext's), which React flags as an invalid
    // render-phase update if done there.
    const order = dragOrderRef.current;
    dragOrderRef.current = null;
    setDragOrder(null);
    if (order && currentList) reorderListItems(currentList.id, order);
  }

  function onHandlePointerDown(e: React.PointerEvent, id: string) {
    if (!currentList) return;
    e.preventDefault();
    e.stopPropagation();
    dragIdRef.current = id;
    const initialOrder = currentList.items.slice();
    dragOrderRef.current = initialOrder;
    setDragOrder(initialOrder);
    dragSession.start(e, { onEngage: () => {}, onEnd: endDrag });
  }

  // Bails out of an in-flight drag if the list itself changes out from under it (e.g. a deep
  // link or Prev/Next navigation while dragging), rather than leaving stale refs/rAF running.
  useEffect(() => {
    if (dragIdRef.current) endDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Same, but for the whole component unmounting mid-drag (e.g. a route change fires while a
  // pointer is still down) — the effect above only fires on a `nodeId` change, not on unmount,
  // so without this the rAF loop's only exit condition (`!dragIdRef.current`) never fires and it
  // runs forever against a detached pane.
  useEffect(() => {
    return () => {
      if (dragIdRef.current) endDrag();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reveals the sutta the user just came from — e.g. tapping a list-membership chip in the
  // Reader now opens this pane with `selectedId` set (see ReaderPage's chip onClick) rather than
  // just the tree row for the list itself. `block: 'nearest'` makes this a no-op if the row's
  // already in view, so it doesn't fight normal in-list browsing.
  useEffect(() => {
    if (!selectedId) return;
    itemRowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, nodeId]);

  // Mirrors TreePane's own keyboard-highlighted hit onto its row here (see activeId's own
  // comment) — `block: 'nearest'` keeps this a no-op once the row's already in view, matching the
  // `selectedId` effect above.
  useEffect(() => {
    if (!searching || !activeId) return;
    itemRowRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [searching, activeId]);

  if (!corpus) return null;

  const title = searching ? 'Search' : nodeLabel(corpus, nodeId || '', lists);
  const readCount = items.filter(([id]) => visited[id]).length;
  const meta = searching
    ? hits.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+ results` : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`
    : `${items.length} suttas · ${readCount} read`;

  return (
    <section data-component="ListPane" className={`flex flex-col h-full min-w-0 ${mobile ? '' : 'bg-listpane'}`} style={{ flex: 1 }}>
      <header className="flex-none flex items-center gap-5 px-5 pt-4 pb-3.5 border-b border-ink/10">
        {mobile && (
          <button
            className="flex-none flex flex-col items-center gap-0.5 font-sans text-[11px] text-ink/50"
            aria-label="Back"
            onClick={onBack}
          >
            <ArrowLeft size={15} strokeWidth={1.75} />
            Back
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-sans text-[19px] font-semibold tracking-[-.01em] truncate">{title}</div>
          <div className="font-sans text-xs text-ink/[.42] mt-[2px]">{meta}</div>
        </div>
        {currentList && !currentList.auto && (
          <button
            className={`flex-none w-[26px] h-[26px] border rounded-md flex items-center justify-center ${
              reorderMode ? 'border-accent2 bg-accent2 text-[#FBFAF7]' : 'border-ink/[.20] bg-transparent text-ink/50 hover:bg-ink/[.06]'
            }`}
            aria-label={reorderMode ? 'Hide reorder handles' : 'Show reorder handles'}
            title={reorderMode ? 'Hide reorder handles' : 'Show reorder handles'}
            onClick={() => setReorderMode((m) => !m)}
          >
            <ArrowUpDown size={13} strokeWidth={2} />
          </button>
        )}
      </header>
      <div
        ref={scrollRef}
        className="sc flex-1"
        style={
          dragOrder
            ? { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }
            : undefined
        }
      >
        {displayItems.map(([id, s]) => {
          // Highlighted (subtle tint + left accent stripe) whenever this row is the sutta the
          // current URL ends in (`/browse/:nodeId/:suttaId` — matches LibraryPage's Up/Down/
          // Enter, which key off the same `suttaId`) or, while searching, the one TreePane's own
          // arrow-key nav currently has active (see activeId's own comment).
          const on = id === selectedId || (searching && id === activeId);
          const note = notes[id];
          const { chips, hlCount } = rowMeta.get(id) ?? { chips: [], hlCount: 0 };
          const dragging = dragIdRef.current === id;
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) itemRowRefs.current.set(id, el);
                else itemRowRefs.current.delete(id);
              }}
              className="relative border-b border-ink/[.08]"
              style={dragging ? { opacity: 0.5 } : undefined}
            >
              <button
                className={`block w-full text-left px-5 py-[13px] ${currentList && !currentList.auto && reorderMode ? 'pr-12' : ''} ${on ? 'bg-ink/[.05]' : ''}`}
                style={on ? { boxShadow: 'inset 2px 0 0 rgb(var(--accent2))' } : undefined}
                onClick={() => onOpen(id)}
              >
                <span>
                  <span className="font-sans text-[14.5px] font-bold tracking-[.02em] mr-2.5 text-ink/60">{s.ref}</span>
                  <span className="text-[16.5px] leading-[1.3] font-serif">{s.en}</span>
                  {visited[id] && (
                    <span className="inline-flex align-middle ml-2.5 text-ink/[.28]">
                      <Check size={13} strokeWidth={2.25} />
                    </span>
                  )}
                </span>
                <span className="block font-serif text-[13.5px] italic mt-[1px] text-accent-text">{s.pali}</span>
                {note ? (
                  <span className="block font-serif text-[14.5px] leading-[1.45] mt-[7px] pl-[10px] border-l-2 border-ink/30">
                    {note}
                  </span>
                ) : (
                  <span className="block text-[14px] leading-[1.5] mt-1.5 text-ink/[.72]">{s.blurb}</span>
                )}
                {(chips.length > 0 || hlCount > 0) && (
                  <span className="flex flex-wrap items-center gap-1.5 mt-2">
                    {chips.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center h-5 whitespace-nowrap rounded-[10px] px-[9px] font-sans text-[11px] border border-ink/25"
                      >
                        {c.breadcrumb}
                      </span>
                    ))}
                    {hlCount > 0 && <HighlightCountBadge count={hlCount} />}
                  </span>
                )}
              </button>
              {currentList && !currentList.auto && reorderMode && (
                <span
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded text-ink/40"
                  style={{
                    touchAction: 'none',
                    cursor: 'grab',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                  onPointerDown={(e) => onHandlePointerDown(e, id)}
                >
                  <GripVertical size={16} strokeWidth={2} />
                </span>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="font-sans text-center text-[13.5px] text-ink/40 py-10 px-5">
            {searching ? `Nothing matches "${query}".` : 'Nothing here yet.'}
          </div>
        )}
      </div>
    </section>
  );
}
