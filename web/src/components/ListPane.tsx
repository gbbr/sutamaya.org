import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, GripVertical } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { listItemsFor, nodeLabel } from '../lib/corpus';
import { highlightCountsByColor } from '../lib/highlights';
import { autoScrollEdge } from '../lib/dragAutoScroll';
import { flattenListTree, resolveListById } from '../lib/lists';
import { AUTO_LIST_IDS } from '../lib/autoLists';
import type { Sutta } from '../lib/types';

interface ListPaneProps {
  nodeId?: string;
  selectedId?: string;
  query: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onOpenReader: (id: string) => void;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
}

export function ListPane({ nodeId, selectedId, query, onBack, onOpen, onOpenReader, visible = true }: ListPaneProps) {
  const { corpus } = useCorpus();
  const { lists, membership, notes, highlights, visited, reorderListItems } = useUserData();
  const { mobile, desktop, previewHidden, showPreview, paneW } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>(`list:${query.trim() ? 'search' : nodeId || 'none'}`, visible);
  const itemRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const searching = query.trim().length > 0;
  const currentList = !searching ? lists.find((l) => String(l.id) === nodeId) : undefined;
  // "Highlights"/"Notes" membership is redundant here — a row already shows note text and
  // highlight-count circles directly, so the auto lists never appear as chips.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);

  const items = useMemo(
    () => (corpus ? listItemsFor(corpus, nodeId, query, notes, lists, membership) : []),
    [corpus, nodeId, query, notes, lists, membership]
  );

  // Pointer Events (not HTML5 drag-and-drop, which touch browsers largely don't fire) drive a
  // single-list drag-reorder: the dragged item's id and a live working copy of the order live in
  // refs/state here, `dragOrder` (rendered instead of `items` while set) shifts live as the
  // pointer crosses row midpoints, and a rAF loop auto-scrolls the list — and keeps re-evaluating
  // the drop target — whenever the pointer sits inside the top/bottom edge band, so it also
  // reorders correctly if content scrolls under a stationary finger.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const pointerYRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // Tracks the window-level pointermove/pointerup/pointercancel listeners registered per-drag
  // (see onHandlePointerDown) so endDrag can always remove them — set/capture-based tracking
  // (setPointerCapture) turned out to throw NotFoundError on some mobile browsers even for a
  // real, active touch pointer, silently aborting the drag before it engaged at all; window
  // listeners sidestep that failure mode entirely (same approach as TreePane's list-tree drag).
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  // Mirrors `dragOrder` so endDrag can read the live value. The window-level `onUp` listener
  // that calls endDrag is registered once, at drag-start, so the `endDrag` closure it holds is
  // fixed to that render — reading the `dragOrder` *state* there would see whatever it was back
  // at drag-start (null), not the live in-progress order; a ref isn't tied to any one render.
  const dragOrderRef = useRef<string[] | null>(null);

  const displayItems: Array<[string, Sutta]> =
    dragOrder && corpus
      ? dragOrder.flatMap((id) => (corpus.suttas[id] ? [[id, corpus.suttas[id]] as [string, Sutta]] : []))
      : items;

  function updateDragTarget() {
    const id = dragIdRef.current;
    if (!id) return;
    const y = pointerYRef.current;
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

  function runDragLoop() {
    function tick() {
      if (!dragIdRef.current) {
        rafRef.current = null;
        return;
      }
      autoScrollEdge(scrollRef.current, pointerYRef.current);
      updateDragTarget();
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function endDrag() {
    dragIdRef.current = null;
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
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
    const pointerId = e.pointerId;
    dragIdRef.current = id;
    pointerYRef.current = e.clientY;
    const initialOrder = currentList.items.slice();
    dragOrderRef.current = initialOrder;
    setDragOrder(initialOrder);
    runDragLoop();

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      pointerYRef.current = ev.clientY;
    }
    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      endDrag();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
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

  if (!corpus) return null;

  const title = searching ? 'Search' : nodeLabel(corpus, nodeId || '', lists);
  const readCount = items.filter(([id]) => visited[id]).length;
  const meta = searching ? `${items.length} results` : `${items.length} suttas · ${readCount} read`;

  const style = mobile
    ? { flex: 1 }
    : desktop && !previewHidden
      ? { flex: 'none' as const, width: paneW.list, background: '#F8F6F2' }
      : { flex: 1, background: '#F8F6F2' };

  return (
    <section
      data-component="ListPane"
      className={`flex flex-col h-full min-w-0 ${!mobile && desktop && !previewHidden ? 'border-r border-ink/10' : ''}`}
      style={style}
    >
      <header className="flex-none flex items-baseline gap-3 px-5 pt-4 pb-3.5 border-b border-ink/10">
        {mobile && (
          <button className="font-sans text-[13px] text-ink/50" onClick={onBack}>
            Back
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-sans text-[19px] font-semibold tracking-[-.01em] truncate">{title}</div>
          <div className="font-sans text-xs text-ink/[.42] mt-[2px]">{meta}</div>
        </div>
        {desktop && previewHidden && (
          <button
            className="flex items-center justify-center text-ink/[.55] border border-ink/[.22] rounded-lg w-7 h-7"
            aria-label="Preview"
            title="Preview"
            onClick={showPreview}
          >
            <Eye size={14} strokeWidth={1.75} />
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
          // current URL ends in (`/browse/:nodeId/:suttaId`), regardless of whether a preview
          // widget happens to be showing it — matches LibraryPage's Left/Right/Enter, which key
          // off the same `suttaId` rather than the preview pane's visibility.
          const on = id === selectedId;
          const note = notes[id];
          const chips = (membership[id] || [])
            .filter((c) => !AUTO_LIST_IDS.has(c))
            .map((c) => ({ id: c, breadcrumb: resolveListById(c, flatLists).breadcrumb }));
          const hlCounts = highlightCountsByColor(highlights[id] || []);
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
                className={`block w-full text-left px-5 py-[13px] ${currentList && !currentList.auto ? 'pr-12' : ''} ${on ? 'bg-ink/[.05]' : ''}`}
                style={on ? { boxShadow: 'inset 2px 0 0 #8A6A3B' } : undefined}
                onClick={() => onOpen(id)}
                onDoubleClick={() => onOpenReader(id)}
              >
                <span>
                  <span className="font-sans text-[14.5px] font-bold tracking-[.02em] mr-2.5 text-ink/60">{s.ref}</span>
                  <span className="text-[16.5px] leading-[1.3] font-serif">{s.en}</span>
                  {visited[id] && (
                    <span className="inline-flex align-middle ml-2.5 text-ink/[.28]">
                      <Check size={13} strokeWidth={2.25} />
                    </span>
                  )}
                  {hlCounts.map(({ c, count }) => (
                    <span
                      key={c}
                      className="inline-flex items-center justify-center align-middle ml-1.5 rounded-full font-sans text-[11.5px] font-extrabold"
                      style={{ background: c, color: '#000', minWidth: 20, height: 20, padding: '0 5px' }}
                    >
                      {count}
                    </span>
                  ))}
                </span>
                <span className="block font-serif text-[13.5px] italic mt-[1px] text-accent">{s.pali}</span>
                {note ? (
                  <span
                    className="block font-serif text-[14.5px] leading-[1.45] mt-[7px] pl-[10px] border-l-2"
                    style={{ borderColor: 'rgba(27,25,23,.3)' }}
                  >
                    {note}
                  </span>
                ) : (
                  <span className="block text-[14px] leading-[1.5] mt-1.5 text-ink/[.72]">{s.blurb}</span>
                )}
                {chips.length > 0 && (
                  <span className="flex flex-wrap gap-1.5 mt-2">
                    {chips.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center whitespace-nowrap leading-[1.4] rounded-[10px] px-[9px] py-[2px] font-sans text-[11px] border"
                        style={{ borderColor: 'rgba(27,25,23,.25)' }}
                      >
                        {c.breadcrumb}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              {currentList && !currentList.auto && (
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
