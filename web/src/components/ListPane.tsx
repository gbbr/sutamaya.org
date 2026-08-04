import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, GripVertical } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { listItemsFor, nodeLabel } from '../lib/corpus';
import { highlightCountsByColor } from '../lib/highlights';
import type { Sutta } from '../lib/types';

interface ListPaneProps {
  nodeId?: string;
  selectedId?: string;
  query: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onOpenReader: (id: string) => void;
  activeIndex: number;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
}

export function ListPane({ nodeId, selectedId, query, onBack, onOpen, onOpenReader, activeIndex, visible = true }: ListPaneProps) {
  const { corpus } = useCorpus();
  const { lists, membership, notes, highlights, visited, reorderListItems } = useUserData();
  const { mobile, desktop, twoPane, previewHidden, showPreview, paneW } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>(`list:${query.trim() ? 'search' : nodeId || 'none'}`, visible);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const itemRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const searching = query.trim().length > 0;
  const currentList = !searching ? lists.find((l) => String(l.id) === nodeId) : undefined;
  // "Highlights"/"Notes" membership is redundant here — a row already shows note text and
  // highlight-count circles directly, so the auto lists never appear as chips.
  const autoLabels = useMemo(() => new Set(lists.filter((l) => l.auto).map((l) => l.label)), [lists]);

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
      return next;
    });
  }

  function runDragLoop() {
    const EDGE = 56;
    const MAX_SPEED = 16;
    function tick() {
      if (!dragIdRef.current) {
        rafRef.current = null;
        return;
      }
      const container = scrollRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const y = pointerYRef.current;
        if (y < rect.top + EDGE) container.scrollTop -= MAX_SPEED * Math.min(1, (rect.top + EDGE - y) / EDGE);
        else if (y > rect.bottom - EDGE) container.scrollTop += MAX_SPEED * Math.min(1, (y - (rect.bottom - EDGE)) / EDGE);
      }
      updateDragTarget();
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function onHandlePointerDown(e: React.PointerEvent, id: string) {
    if (!currentList) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragIdRef.current = id;
    pointerYRef.current = e.clientY;
    setDragOrder(currentList.items.slice());
    runDragLoop();
  }
  function onHandlePointerMove(e: React.PointerEvent) {
    if (!dragIdRef.current) return;
    pointerYRef.current = e.clientY;
  }
  function endDrag() {
    dragIdRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    // Read the live value directly rather than committing inside setDragOrder's updater — an
    // updater must be pure, and reorderListItems triggers a *different* component's setState
    // (UserDataContext's), which React flags as an invalid render-phase update if done there.
    const order = dragOrder;
    setDragOrder(null);
    if (order && currentList) reorderListItems(currentList.id, order);
  }
  function onHandlePointerUp(e: React.PointerEvent) {
    if (!dragIdRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    endDrag();
  }

  // Bails out of an in-flight drag if the list itself changes out from under it (e.g. a deep
  // link or Prev/Next navigation while dragging), rather than leaving stale refs/rAF running.
  useEffect(() => {
    if (dragIdRef.current) endDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  useEffect(() => {
    if (activeIndex >= 0) rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

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
    <section className={`flex flex-col h-full min-w-0 ${!mobile && desktop && !previewHidden ? 'border-r border-ink/10' : ''}`} style={style}>
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
            title="Preview"
            onClick={showPreview}
          >
            <Eye size={14} strokeWidth={1.75} />
          </button>
        )}
      </header>
      <div ref={scrollRef} className="sc flex-1">
        {displayItems.map(([id, s], i) => {
          const on = desktop && !previewHidden && !twoPane && id === selectedId;
          const focused = i === activeIndex;
          const note = notes[id];
          const chips = (membership[id] || []).filter((c) => !autoLabels.has(c));
          const hlCounts = highlightCountsByColor(highlights[id] || []);
          const dragging = dragIdRef.current === id;
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) itemRowRefs.current.set(id, el);
                else itemRowRefs.current.delete(id);
              }}
              className={`relative border-b border-ink/[.08] ${on ? 'bg-accent' : ''}`}
              style={dragging ? { opacity: 0.5 } : undefined}
            >
              <button
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`block w-full text-left px-5 py-[13px] ${currentList && !currentList.auto ? 'pr-11' : ''} ${on ? 'text-[#FBFAF7]' : ''} ${focused && !on ? 'bg-ink/[.05]' : ''}`}
                style={focused ? { boxShadow: `inset 2px 0 0 ${on ? 'rgba(251,250,247,.6)' : '#8A6A3B'}` } : undefined}
                onClick={() => onOpen(id)}
                onDoubleClick={() => onOpenReader(id)}
              >
                <span>
                  <span className={`font-sans text-[14.5px] font-bold tracking-[.02em] mr-2.5 ${on ? 'opacity-65' : 'text-ink/60'}`}>{s.ref}</span>
                  <span className="text-[16.5px] leading-[1.3] font-serif">{s.en}</span>
                  {visited[id] && (
                    <span className={`inline-flex align-middle ml-2.5 ${on ? 'opacity-45' : 'text-ink/[.28]'}`}>
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
                <span className={`block font-serif text-[13.5px] italic mt-[1px] ${on ? 'opacity-75' : 'text-accent'}`}>{s.pali}</span>
                {note ? (
                  <span
                    className="block font-serif text-[14.5px] leading-[1.45] mt-[7px] pl-[10px] border-l-2"
                    style={{ borderColor: on ? 'rgba(251,250,247,.5)' : 'rgba(27,25,23,.3)' }}
                  >
                    {note}
                  </span>
                ) : (
                  <span className={`block text-[14px] leading-[1.5] mt-1.5 ${on ? 'opacity-80' : 'text-ink/[.72]'}`}>{s.blurb}</span>
                )}
                {chips.length > 0 && (
                  <span className="flex flex-wrap gap-1.5 mt-2">
                    {chips.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center whitespace-nowrap leading-[1.4] rounded-[10px] px-[9px] py-[2px] font-sans text-[11px] border"
                        style={{ borderColor: on ? 'rgba(251,250,247,.45)' : 'rgba(27,25,23,.25)' }}
                      >
                        {c}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              {currentList && !currentList.auto && (
                <span
                  className={`absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded ${on ? 'text-[#FBFAF7]/70' : 'text-ink/40'}`}
                  style={{ touchAction: 'none', cursor: 'grab' }}
                  onPointerDown={(e) => onHandlePointerDown(e, id)}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
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
