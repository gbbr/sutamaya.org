import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, GripVertical, List, MinusCircle, Pencil } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { usePointerDragSession } from '../hooks/usePointerDragSession';
import { listItemsFor, nodeLabel, SEARCH_RESULTS_CAP, type SearchHit } from '../lib/corpus';
import { flattenListTree, suttaRowMeta } from '../lib/lists';
import { resolveDragReorder, type ItemMidpoint } from '../lib/listPaneDrag';
import { SuttaRowChips } from './SuttaRowChips';
import type { Sutta } from '../lib/types';

// How long the "Removed … Undo" bar stays up after a removal. Removing a sutta from a list
// destroys nothing but its position in that list, so this stands in for a confirmation step
// rather than being added on top of one.
const UNDO_WINDOW_MS = 7000;

// How long the rows below a removed one take to slide up into the space it left. The removal
// itself is immediate — this animates the rows that *stay*, which is what makes the change
// legible without any of them being held on screen after the data says they're gone.
const ROW_SHIFT_MS = 220;

// How long after a removal the remove buttons stop responding. The rows below are sliding up
// into the vacated space, so a tap during that would otherwise land on whichever row is passing
// under the finger rather than the one that was there when it was pressed.
const REMOVE_LOCK_MS = ROW_SHIFT_MS + 120;

// A captured set of row positions goes stale if the removal it belongs to never lands (an
// offline write that errors, a list that changed underneath). Past this, it's dropped rather than
// replayed against some unrelated later change.
const FLIP_CAPTURE_TTL_MS = 500;

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
  const { lists, membership, notes, highlights, visited, reorderListItems, toggleMembership } = useUserData();
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

  // A search hit's row is still keyed/displayed by the batch's own id (`items` above), but
  // opening it should land on the more specific inner sutta the hit actually matched, when there
  // is one (e.g. searching "dhp325" against the "dhp320-333" batch) — see SearchHit.matchedId.
  const openTargets = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hits) if (h.matchedId) map.set(h.id, h.matchedId);
    return map;
  }, [hits]);

  // Chips/highlight-count per row, keyed off `items` rather than the reorder-drag's own
  // `displayItems`: `items` doesn't change while a drag reshuffles display order, so this map
  // survives the whole gesture instead of every visible row's chip/highlight lookups being
  // recomputed on each rAF tick.
  const rowMeta = useMemo(
    () => suttaRowMeta(items.map(([id]) => id), membership, highlights, flatLists),
    [items, membership, flatLists, highlights]
  );

  // Pointer Events (not HTML5 drag-and-drop, which touch browsers largely don't fire) drive a
  // single-list drag-reorder: the dragged item's id and a live working copy of the order live in
  // refs/state here, `dragOrder` (rendered instead of `items` while set) shifts live as the
  // pointer crosses row midpoints. The window-listener/rAF/auto-scroll plumbing itself is shared
  // with TreePane's list-tree drag via usePointerDragSession, which keeps re-evaluating the drop
  // target whenever the pointer sits inside the top/bottom edge band, so it also reorders
  // correctly if content scrolls under a stationary finger.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // Edit mode: the per-row drag handle *and* the remove button. Off by default — both take space
  // every row would otherwise get, and putting removal behind an explicit mode is what keeps a
  // stray tap while browsing from pulling a sutta out of a list (mirrors TreePane's own
  // reorder-mode toggle for the list tree). Never offered for an auto list, whose membership is
  // derived rather than stored — see the header toggle's `!currentList.auto` guard.
  const [editMode, setEditMode] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  // Mirrors `dragOrder` so endDrag can read the live value. The window-level `onUp` listener
  // that calls endDrag is registered once, at drag-start, so the `endDrag` closure it holds is
  // fixed to that render — reading the `dragOrder` *state* there would see whatever it was back
  // at drag-start (null), not the live in-progress order; a ref isn't tied to any one render.
  const dragOrderRef = useRef<string[] | null>(null);

  // The last removal, kept only long enough to offer an undo. `order` is the list's item order as
  // it was *before* the removal: re-adding appends to the end (see queueMembership), so putting
  // the row back where it was means replaying that order on top of the re-add.
  type Undoable = { listId: string; suttaId: string; ref: string; order: string[] };
  const [undone, setUndone] = useState<Undoable | null>(null);
  const undoTimer = useRef<number | null>(null);

  function armUndo(next: Undoable | null) {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = next ? window.setTimeout(() => setUndone(null), UNDO_WINDOW_MS) : null;
    setUndone(next);
  }

  // A deadline rather than a piece of state: the lock only ever gates the tap handler, so it has
  // no business re-rendering the pane when it arms or lapses.
  const removeLockedUntil = useRef(0);

  // Where every mounted row sat just before a removal changed the list — the "First" half of a
  // FLIP. The layout effect below reads it once the new rows are laid out, and animates
  // each surviving row from where it was to where it now is. Viewport coordinates, not offsets
  // within the scroll container, so a scroll adjustment the browser makes as the content shrinks
  // is already accounted for in the delta.
  const flipFrom = useRef<{ at: number; node: string | undefined; tops: Map<string, number> } | null>(null);

  function captureRowPositions() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const tops = new Map<string, number>();
    for (const [id, el] of itemRowRefs.current) tops.set(id, el.getBoundingClientRect().top);
    flipFrom.current = { at: performance.now(), node: nodeId, tops };
  }

  // Runs after every render that changed the rendered rows, but only does anything when a capture
  // is waiting — i.e. when this render is the one applying a removal. Layout effect,
  // not a plain one: the rows have to be moved back to their old positions before the browser
  // gets a chance to paint them in their new ones.
  useLayoutEffect(() => {
    const capture = flipFrom.current;
    flipFrom.current = null;
    // A capture from another list (switched away within the TTL) describes rows that aren't on
    // screen any more — those positions mean nothing here.
    if (!capture || capture.node !== nodeId || performance.now() - capture.at > FLIP_CAPTURE_TTL_MS) return;
    for (const [id, el] of itemRowRefs.current) {
      const was = capture.tops.get(id);
      if (was === undefined) continue;
      const rect = el.getBoundingClientRect();
      const dy = was - rect.top;
      // Rows that didn't move (everything above the removal) and rows scrolled out of sight have
      // nothing worth animating.
      if (!dy || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: ROW_SHIFT_MS,
        easing: 'ease-out',
      });
    }
    // `items`, not the drag's `displayItems`: a reorder drag shuffles rows every frame under the
    // finger and must never be animated on top of.
  }, [items]);

  function onRemove(id: string, ref: string) {
    if (!currentList || currentList.auto) return;
    // Nothing for a beat after the last removal, while the rows are still moving — see
    // REMOVE_LOCK_MS.
    if (performance.now() < removeLockedUntil.current) return;
    removeLockedUntil.current = performance.now() + REMOVE_LOCK_MS;
    captureRowPositions();
    armUndo({ listId: currentList.id, suttaId: id, ref, order: currentList.items.slice() });
    void toggleMembership(id, currentList.id);
  }

  function onUndo() {
    if (!undone) return;
    const { listId, suttaId, order } = undone;
    armUndo(null);
    void toggleMembership(suttaId, listId).then(() => reorderListItems(listId, order));
  }

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
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { itemId, mid: rect.top + rect.height / 2 };
        })
        .filter((x): x is ItemMidpoint => !!x);
      const next = resolveDragReorder(order, id, mids, y);
      if (next === order) return order;
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
    // The undo offer belongs to the list it was made in — left up across a switch it would put a
    // "Removed …" bar over a list that row was never in.
    armUndo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Same, but for the whole component unmounting mid-drag (e.g. a route change fires while a
  // pointer is still down) — the effect above only fires on a `nodeId` change, not on unmount,
  // so without this the rAF loop's only exit condition (`!dragIdRef.current`) never fires and it
  // runs forever against a detached pane.
  useEffect(() => {
    return () => {
      if (dragIdRef.current) endDrag();
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
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

  const title = searching ? { label: 'Search' } : nodeLabel(corpus, nodeId || '', lists);
  const readCount = items.filter(([id]) => visited[id]).length;
  const meta = searching
    ? hits.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+ results` : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`
    : `${items.length} suttas · ${readCount} read`;

  return (
    <section data-component="ListPane" className={`flex flex-col h-full min-w-0 ${mobile ? '' : 'bg-listpane'}`} style={{ flex: 1 }}>
      <header className="flex-none flex items-center gap-3 px-5 pt-4 pb-3.5 border-b border-ink/10">
        {mobile && (
          // Deliberately the same 28px round icon button as the edit toggle on the right, so the
          // header reads as icon / title / icon. The border and chip fill are what make it read
          // as a control at rest — an unfilled grey chevron doesn't — and match the pill toggle's
          // thumb in TreePane's header. The `after` pseudo-element pads the tap target out to
          // ~44px without growing the circle or shifting anything else in the flex row.
          <button
            className="relative flex-none w-[28px] h-[28px] rounded-full flex items-center justify-center border border-ink/[.12] bg-chip/40 text-ink/60 hover:text-ink active:bg-ink/[.08] after:content-[''] after:absolute after:-inset-2"
            aria-label="Back"
            onClick={onBack}
          >
            <ChevronLeft size={17} strokeWidth={2} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {currentList && <List size={14} strokeWidth={2} className="flex-none text-ink" />}
            <div className="min-w-0 truncate">
              <span className="font-sans text-[19px] font-semibold tracking-[-.01em]">{title.label}</span>
            </div>
          </div>
          <div className="font-sans text-xs text-ink/[.42] mt-[2px]">
            {title.ref && <span className="font-sans text-ink/45">{title.ref} · </span>}{meta}
          </div>
        </div>
        {currentList && !currentList.auto && (
          <button
            // The bordered resting state is mobile-only, to match the back button beside it.
            // On desktop there's no back button to pair with, and hover already tells you the
            // icon is a control, so it stays bare until pointed at.
            className={`flex-none w-[28px] h-[28px] rounded-full flex items-center justify-center ${
              editMode
                ? 'bg-accent2 text-[#FBFAF7]'
                : mobile
                  ? 'border border-ink/[.12] bg-chip/40 text-ink/60 hover:text-ink active:bg-ink/[.08]'
                  : 'text-ink/45 hover:bg-ink/[.08] hover:text-ink'
            }`}
            aria-label={editMode ? 'Done editing list' : 'Edit list'}
            title={editMode ? 'Done editing list' : 'Edit list'}
            onClick={() => setEditMode((m) => !m)}
          >
            <Pencil size={13} strokeWidth={2} />
          </button>
        )}
      </header>
      {/* The undo bar floats over the top of the rows rather than sitting in the flex column with
          them: in flow it would push the whole list down ~44px on removal and back up when it
          times out, shifting rows under the finger in the one mode where the next tap is likely
          another remove button. The zero-height wrapper is what keeps it out of the flow — it
          takes no space in the column, and the bar hangs off it just below the header. */}
      {undone && (
        <div className="relative flex-none h-0 z-10">
          <div
            className={`absolute left-0 right-0 top-0 flex items-center gap-3 px-5 py-3 border-b border-ink/10 shadow-popup animate-fadeUp font-sans text-[13px] text-ink/70 ${
              mobile ? 'bg-paper' : 'bg-listpane'
            }`}
          >
            <span className="flex-1 min-w-0 truncate">Removed {undone.ref}</span>
            {/* Padded out to a real target — the negative margins keep the bar the same height,
                and the `after` pseudo-element takes the tappable area past 44px without any of
                that padding being visible. */}
            <button
              className="relative flex-none font-semibold text-accent-text px-2.5 py-1.5 -my-1.5 -mr-1 rounded hover:bg-accent-text/[.09] after:content-[''] after:absolute after:-inset-2"
              onClick={onUndo}
            >
              Undo
            </button>
          </div>
        </div>
      )}
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
          const editing = !!currentList && !currentList.auto && editMode;
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
                className={`block w-full text-left px-5 py-[13px] ${editing ? 'pl-12 pr-12' : ''} ${on ? 'bg-ink/[.05]' : ''}`}
                style={on ? { boxShadow: 'inset 2px 0 0 rgb(var(--accent2))' } : undefined}
                onClick={() => onOpen(openTargets.get(id) ?? id)}
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
                <SuttaRowChips chips={chips} hlCount={hlCount} />
              </button>
              {editing && (
                <button
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-danger-text/55 hover:text-danger-text"
                  aria-label={`Remove ${s.ref} from this list`}
                  title={`Remove ${s.ref} from this list`}
                  onClick={() => onRemove(id, s.ref)}
                >
                  <MinusCircle size={17} strokeWidth={2} />
                </button>
              )}
              {editing && (
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
