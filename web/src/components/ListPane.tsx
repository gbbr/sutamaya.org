import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronLeft, GripVertical, Info, List, ListPlus } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { usePointerDragSession } from '../hooks/usePointerDragSession';
import {
  findNode,
  isExpandable,
  listItemsFor,
  nodeBlurb,
  nodeLabel,
  SEARCH_RESULTS_CAP,
  SEARCH_SCOPE_NOTE,
  type ListHit,
  type SearchHit,
} from '../lib/corpus';
import { flattenListTree, suttaRowMeta } from '../lib/lists';
import { resolveDragReorder, type ItemMidpoint } from '../lib/listPaneDrag';
import { MatchedText } from './MatchedText';
import { SearchListHits } from './SearchListHits';
import { SuttaRowChips } from './SuttaRowChips';
import { ListMembershipPopover } from './ListMembershipPopover';
import type { Sutta } from '../lib/types';

interface ListPaneProps {
  nodeId?: string;
  selectedId?: string;
  query: string;
  // The sutta hits, scanned once by LibraryPage and shared with TreePane, so both panes show one
  // result set.
  hits: SearchHit[];
  // The list hits, drawn as their own block above the results, already trimmed to what renders.
  listHits: ListHit[];
  listHitTotal: number;
  listsExpanded: boolean;
  onToggleListsExpanded: () => void;
  onSelectList: (nodeId: string) => void;
  // The sutta hit TreePane's arrow-key cursor is on, mirrored onto that row here.
  activeId?: string;
  // The same, while that cursor is up in the lists block instead.
  activeListId?: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  // False while this pane is mounted but hidden on mobile, which scroll restoration has to know.
  visible?: boolean;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function ListPane({
  nodeId,
  selectedId,
  query,
  hits,
  listHits,
  listHitTotal,
  listsExpanded,
  onToggleListsExpanded,
  onSelectList,
  activeId,
  activeListId,
  onBack,
  onOpen,
  visible = true,
}: ListPaneProps) {
  const { corpus } = useCorpus();
  const { ready, lists, membership, notes, highlights, reorderListItems } = useUserData();
  const { mobile, paneW } = useLayout();
  // The pane's scroll, held until the mirror lands: a row's note text and highlight count arrive
  // after the row, and one growing above the scroll position would shift it post-restore.
  const scrollRef = useScrollMemory<HTMLDivElement>(
    `list:${query.trim() ? 'search' : nodeId || 'none'}`,
    visible,
    { readyToRestore: ready }
  );
  const itemRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const searching = query.trim().length > 0;
  // What the rows mark up: nothing while browsing, this pane drawing browse rows and results
  // through the same map.
  const rowQuery = searching ? query : '';
  const currentList = !searching ? lists.find((l) => String(l.id) === nodeId) : undefined;
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);

  // The rows to draw: the capped hits while searching, else whatever the selected node or list
  // holds, in its own order. `hits` stays uncapped, so the count below is honest.
  const items = useMemo<Array<[string, Sutta]>>(() => {
    // A placeholder for the window before the corpus lands, in which the pane renders nothing.
    if (!corpus) return [];
    if (searching) return hits.slice(0, SEARCH_RESULTS_CAP).map(({ id, sutta }) => [id, sutta] as [string, Sutta]);
    return listItemsFor(corpus, nodeId, lists);
  }, [corpus, nodeId, lists, searching, hits]);

  // Whether these rows can be reordered: only a user list's, an auto-list's membership being
  // derived, and only once two of them have somewhere to move.
  const canReorder = !!currentList && !currentList.auto && items.length >= 2;

  // Where a row opens to, when that isn't the row's own id — a hit inside a batched document is
  // keyed by the batch and opens on the inner sutta it matched.
  const openTargets = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hits) if (h.matchedId) map.set(h.id, h.matchedId);
    return map;
  }, [hits]);

  // Each row's chips and highlight count, keyed off `items` rather than the drag's own order, so
  // the map survives a whole gesture rather than being rebuilt on every frame.
  const rowMeta = useMemo(
    () => suttaRowMeta(items.map(([id]) => id), membership, highlights, flatLists, currentList?.id),
    [items, membership, flatLists, highlights, currentList?.id]
  );

  // The live order while a row is being dragged, rendered in place of `items` and reshuffled as
  // the pointer crosses row midpoints.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // Whether the drag handles are showing, which takes space from every row, so they wait for the
  // header's toggle — itself shown only when `canReorder`.
  const [reorderMode, setReorderMode] = useState(false);
  // The row whose membership popover is open, and the rect of the control that opened it. Held
  // here so it outlives the row: unchecking the list being viewed drops that sutta out of `items`.
  const [picker, setPicker] = useState<{ suttaId: string; anchor: DOMRect } | null>(null);
  // Whether the blurb is expanded past its clamp, and whether it has anything to expand to —
  // measured after layout, where the text wraps depending on the pane's width and the type scale.
  const [blurbOpen, setBlurbOpen] = useState(false);
  const [blurbOverflows, setBlurbOverflows] = useState(false);
  const blurbRef = useRef<HTMLDivElement | null>(null);
  const dragIdRef = useRef<string | null>(null);
  // Mirrors `dragOrder` for endDrag, whose window listener is registered once at drag-start and
  // would otherwise read the order as it was then — null.
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
    // Idempotent: a no-op once the session tore itself down on pointerup, and the only teardown
    // path when this is called from a bail-out.
    dragSession.cancel();
    dragIdRef.current = null;
    // Read through the ref rather than committed inside setDragOrder's updater, which has to be
    // pure — reorderListItems sets state, which React flags as a render-phase update.
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

  // Ends an in-flight drag when the list changes under it, rather than leaving stale refs and a
  // running rAF loop.
  useEffect(() => {
    if (dragIdRef.current) endDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // The same on unmount, which the effect above, keyed on `nodeId`, doesn't cover.
  useEffect(() => {
    return () => {
      if (dragIdRef.current) endDrag();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismisses the membership popover, which is anchored to a rect captured at open, whenever
  // anything moves the rows under it: the pane's contents, reorder mode, or the pane being hidden.
  useEffect(() => {
    setPicker(null);
  }, [nodeId, searching, reorderMode, visible]);

  useEffect(() => {
    setBlurbOpen(false);
  }, [nodeId]);

  // Measures whether the blurb overflows its clamp, after every render that could change the wrap:
  // a new blurb, the clamp coming off, the pane being resized or revealed.
  useEffect(() => {
    const el = blurbRef.current;
    if (!el) {
      setBlurbOverflows(false);
      return;
    }
    setBlurbOverflows(blurbOpen || el.scrollHeight > el.clientHeight + 1);
  }, [nodeId, blurbOpen, paneW, visible, mobile]);

  // Leaves reorder mode when the toggle that turns it off stops being shown.
  useEffect(() => {
    if (!canReorder) setReorderMode(false);
  }, [canReorder]);

  // Reveals the sutta the reader came from, a list-membership chip in the Reader opening this pane
  // with `selectedId` set. `block: 'nearest'` keeps it a no-op when the row is already in view.
  useEffect(() => {
    if (!selectedId) return;
    itemRowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, nodeId]);

  // Mirrors TreePane's keyboard-highlighted hit onto its row here. `block: 'nearest'` keeps it a
  // no-op once the row is in view, matching the `selectedId` effect above.
  useEffect(() => {
    if (!searching || !activeId) return;
    itemRowRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [searching, activeId]);

  if (!corpus) return null;

  const title = searching
    ? { label: 'Search' }
    : nodeId
      ? nodeLabel(corpus, nodeId, lists)
      : { label: 'Library' };
  // What `nodeId` names, for the header and empty state below: a corpus row (and whether it
  // expands rather than holding suttas), a user list, or — once a list is deleted — neither.
  // `ready` is what separates "no such list" from "the mirror hasn't loaded yet".
  const corpusNode = nodeId ? findNode(corpus, nodeId) : null;
  const expandableNode = !!corpusNode && isExpandable(corpusNode.node);
  const goneList = !!nodeId && !searching && ready && !currentList && !corpusNode;
  // The corpus node's description, skipped for a user list and while searching.
  const { blurb, from: blurbFrom } = searching || currentList ? { blurb: undefined, from: undefined } : nodeBlurb(corpus, nodeId);
  // Read off `corpus` here because `if (!corpus) return null` doesn't narrow inside metaLine.
  const collectionCount = corpus.nikayas.length;
  // metaLine returns the counted line under the pane's title, naming what the pane is showing.
  //   nothing selected  – the number of collections
  //   a deleted list    – empty, since it holds nothing rather than zero things
  //   a node or list    – its sutta count, an auto-list's being what the reader has, uncapped
  //   a search          – the sutta count, "80+" past the cap, and the matched lists beside it
  function metaLine(): string {
    if (!searching) {
      if (!nodeId) return `${collectionCount} collections`;
      if (goneList) return '';
      return plural(currentList?.total ?? items.length, 'sutta');
    }
    // "suttas" rather than "results" whenever lists matched too, so the number names what it counts.
    const noun = listHitTotal > 0 ? 'sutta' : 'result';
    const suttas = hits.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+ ${noun}s` : plural(hits.length, noun);
    if (listHitTotal === 0) return suttas;
    const matchedLists = plural(listHitTotal, 'list');
    return hits.length === 0 ? matchedLists : `${suttas} · ${matchedLists}`;
  }
  const meta = metaLine();

  // reorderToggleClass returns the reorder toggle's colour treatment; size and margins are on the
  // button itself.
  //   reorder mode on – filled accent
  //   at rest, mobile – bordered chip, matching the back button beside it
  //   at rest, desktop – a bare round icon button, matching TreePane's header controls
  function reorderToggleClass(): string {
    if (reorderMode) return 'bg-accent2 text-[#FBFAF7]';
    if (mobile) return 'border border-ink/[.12] bg-chip/40 text-ink-3 hover:text-ink active:bg-ink/[.08]';
    return 'text-ink-3 hover:bg-ink/[.06]';
  }

  // emptyMessage returns the empty state under the rows.
  //   searching       – a query that matched nothing, quoted back
  //   expandable node – a corpus row whose suttas are a level down, reached by URL only
  //   gone list       – a list deleted here, on another device, or an outlived link
  //   node or list    – one the reader picked that holds nothing
  //   nothing chosen  – bare /browse, which only the two-pane layout shows
  function emptyMessage(): string {
    if (searching) return `Nothing matches "${query}".`;
    if (expandableNode) return 'Choose a chapter to see its suttas.';
    if (goneList) return 'This list is no longer here.';
    if (nodeId) return 'Nothing here yet.';
    return 'Choose a collection to begin.';
  }

  return (
    <section data-component="ListPane" className={`flex flex-col h-full min-w-0 ${mobile ? '' : 'bg-listpane'}`} style={{ flex: 1 }}>
      <header className="flex-none flex items-center gap-3.5 px-6 pt-5 pb-4 border-b border-ink/10">
        {mobile && (
          // The same round icon button as the reorder toggle on the right. Its `after`
          // pseudo-element pads the tap target to ~44px without growing the circle.
          <button
            className="relative flex-none w-[34px] h-[34px] rounded-full flex items-center justify-center border border-ink/[.12] bg-chip/40 text-ink-3 hover:text-ink active:bg-ink/[.08] after:content-[''] after:absolute after:-inset-[5px]"
            aria-label="Back"
            onClick={onBack}
          >
            <ChevronLeft size={23} strokeWidth={2} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {currentList && <List size={17} strokeWidth={2} className="flex-none text-ink" />}
            <div className="min-w-0 truncate">
              <span className="font-sans text-ui-2xl font-semibold tracking-[-.01em]">{title.label}</span>
            </div>
          </div>
          <div className="font-sans text-ui-xs text-ink-4 mt-[2px]">
            {title.ref && <span className="font-sans text-ink-4">{title.ref} · </span>}{meta}
          </div>
        </div>
        {canReorder && (
          <button
            // The negative right margin lands its centre on the axis the row controls sit on.
            className={`flex-none rounded-full flex items-center justify-center ${mobile ? 'w-[34px] h-[34px] -mr-[7px]' : 'w-[38px] h-[38px] -mr-[9px]'} ${reorderToggleClass()}`}
            aria-label={reorderMode ? 'Hide reorder handles' : 'Show reorder handles'}
            title={reorderMode ? 'Hide reorder handles' : 'Show reorder handles'}
            onClick={() => setReorderMode((m) => !m)}
          >
            {/* 16 on both platforms, where the other header glyphs step up to 18–20 on desktop:
                two stacked arrows fill their box where a chevron leaves air. */}
            <ArrowUpDown size={16} strokeWidth={2} />
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
        {/* Matching lists, above the results. This pane draws the block on desktop; TreePane
            draws it on mobile. */}
        {searching && (
          <SearchListHits
            hits={listHits}
            total={listHitTotal}
            expanded={listsExpanded}
            onToggleExpanded={onToggleListsExpanded}
            query={query}
            activeId={activeListId}
            onSelect={onSelectList}
            padX="px-6"
          />
        )}
        {/* The node's description, above its suttas and inside the scroller, so a long one
            scrolls away. A wash and the rules above and below set it off from the rows.

            The eyebrow names what the description is about: a bare "About" for this page, or
            "About SN12 · Causation" for one borrowed from an ancestor, which every SN vagga's is.

            Clamped to three lines, the whole block toggling, with the "More" affordance shown
            only once the text is measured to overflow. The expanded state restores `display:
            block`, which `line-clamp-3`'s `-webkit-box` would otherwise hold.

            `blurb` carries the same inline HTML a translator note does — see SegmentedText. */}
        {blurb && (
          <div className="bg-ink/[.015] border-b border-ink/[.08] px-6 pt-4 pb-[18px]">
            {/* The icon is decorative — it marks the block as an aside rather than another row,
                and carries no action, so it's hidden from the reader. Sized to the cap height of
                the eyebrow beside it, and the negative top nudge sits its optical centre on the
                text's, which uppercase tracking otherwise throws off. */}
            <div className="flex items-center gap-1.5 font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
              <Info size={12} strokeWidth={2.25} className="flex-none -mt-px" aria-hidden />
              {blurbFrom ? `About ${blurbFrom}` : 'About'}
            </div>
            {(() => {
              const text = (
                <span
                  ref={blurbRef}
                  className={`text-ui-base leading-[1.6] text-ink-2 ${blurbOpen ? 'block' : 'line-clamp-3'}`}
                  dangerouslySetInnerHTML={{ __html: blurb }}
                />
              );
              if (!blurbOverflows) return text;
              return (
                <button
                  className="block w-full text-left"
                  aria-expanded={blurbOpen}
                  onClick={() => setBlurbOpen((o) => !o)}
                >
                  {text}
                  {/* Chrome, not content: neutral rather than the accent inline text actions
                      carry elsewhere, since the paragraph is the target and this only reports
                      its state. */}
                  <span className="flex items-center gap-1 font-sans text-ui-xs font-semibold text-ink-4 mt-1">
                    {blurbOpen ? 'Less' : 'More'}
                    <ChevronDown
                      size={14}
                      strokeWidth={2.25}
                      className={`flex-none transition-transform ${blurbOpen ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>
              );
            })()}
          </div>
        )}

        {displayItems.map(([id, s]) => {
          // Highlighted — a tint plus a left accent stripe — only while searching, for the hit
          // TreePane's arrow-key nav has active. Nothing marks the URL's `selectedId`.
          const on = searching && id === activeId;
          const note = notes[id];
          const { chips, hlCount, hlColors } = rowMeta.get(id) ?? { chips: [], hlCount: 0, hlColors: [] };
          const dragging = dragIdRef.current === id;
          const reordering = canReorder && reorderMode;
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) itemRowRefs.current.set(id, el);
                else itemRowRefs.current.delete(id);
              }}
              className="group relative border-b border-ink/[.08]"
              style={dragging ? { opacity: 0.5 } : undefined}
            >
              {/* The right gutter is kept clear only where a control sits: at rest the add-to-list
                  button holds the top of the row, so the title and Pali line give up the width
                  while the blurb and chips run its full measure; while reordering the grip is
                  centred and the whole row clears it. The rows carry no hover state. */}
              <button
                className={`block w-full text-left px-6 py-[16px] ${reordering ? 'pr-14' : ''} ${
                  on ? 'bg-ink/[.05]' : ''
                }`}
                style={on ? { boxShadow: 'inset 2px 0 0 rgb(var(--accent2))' } : undefined}
                onClick={() => onOpen(openTargets.get(id) ?? id)}
              >
                <span className={`block ${reordering ? '' : 'pr-14'}`}>
                  <span className="font-sans text-ui-md font-bold tracking-[.02em] mr-2.5 text-ink-3">
                    <MatchedText text={s.ref} query={rowQuery} />
                  </span>
                  <span className="text-ui-lg leading-[1.3] font-serif">
                    <MatchedText text={s.en} query={rowQuery} />
                  </span>
                </span>
                <span
                  className={`block font-serif text-ui-base italic mt-[3px] text-accent-text ${reordering ? '' : 'pr-14'}`}
                >
                  <MatchedText text={s.pali} query={rowQuery} />
                </span>
                {note ? (
                  // An em dash rather than a quote rule marks this as the reader's own note.
                  <span className="flex gap-[7px] font-serif text-ui-md leading-[1.45] mt-[7px] text-ink-2">
                    <span aria-hidden className="flex-none text-ink-3">
                      —
                    </span>
                    {/* Clamped, like the blurb it stands in for. */}
                    <span className="line-clamp-3 whitespace-pre-wrap">
                      <MatchedText text={note} query={rowQuery} notation />
                    </span>
                  </span>
                ) : (
                  // No `block` alongside `line-clamp-3`: the clamp sets `display:-webkit-box` and
                  // Tailwind emits it before `.block`, so `block` would silently win.
                  <span className="text-ui-md leading-[1.5] mt-1.5 text-ink-2 line-clamp-3">
                    <MatchedText text={s.blurb} query={rowQuery} />
                  </span>
                )}
                <SuttaRowChips chips={chips} hlCount={hlCount} hlColors={hlColors} />
              </button>
              {/* Opens the list-membership picker for this sutta. Hidden while reordering, so the
                  grip has the gutter to itself, and held at the top corner of the row, its `top`
                  inset matching its `right` one.

                  Dimmed at rest and brought to full strength on row hover or keyboard focus. The
                  dim sits inside `@media (hover: hover)`, so a touch device that gets the desktop
                  layout shows it at full strength rather than needing a pointer to reveal it.

                  Its centre is on the same axis as the header's reorder toggle and the grip, which
                  is the width the rows reserve with `pr-14`. */}
              {!reordering && (
                <button
                  className={`absolute ${mobile ? 'right-3 top-3 w-11 h-11' : 'right-[15px] top-[15px] w-[38px] h-[38px]'} flex items-center justify-center rounded-full text-ink-3 hover:bg-ink/[.06] active:bg-ink/[.10] transition-opacity [@media(hover:hover)]:opacity-45 group-hover:opacity-100 focus-visible:opacity-100`}
                  aria-label={`Add ${s.ref} to a list`}
                  onClick={(e) => setPicker({ suttaId: id, anchor: e.currentTarget.getBoundingClientRect() })}
                >
                  <ListPlus size={mobile ? 20 : 18} strokeWidth={2} />
                </button>
              )}
              {reordering && (
                <span
                  // `right-3` puts the drag target's centre on the same axis as the add-to-list
                  // button it replaces, so nothing shifts sideways when reorder mode comes on, and
                  // `inset-y-1` makes the whole right gutter of the row grabbable.
                  className="absolute right-3 inset-y-1 w-11 flex items-center justify-center rounded text-ink-3"
                  style={{
                    touchAction: 'none',
                    cursor: 'grab',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                  onPointerDown={(e) => onHandlePointerDown(e, id)}
                >
                  <GripVertical size={19} strokeWidth={2} />
                </span>
              )}
            </div>
          );
        })}
        {/* Where an auto-list stopped, said at the foot of the rows, where the reader meets the
            boundary. */}
        {currentList?.total !== undefined && currentList.total > items.length && (
          <div className="font-sans text-center text-ui-sm text-ink-4 py-6 px-6">
            Showing {items.length} of {currentList.total}
          </div>
        )}
        {/* A query that matched only lists isn't a failed search, so it keeps its empty state. */}
        {items.length === 0 && !(searching && listHitTotal > 0) && (
          <div className="font-sans text-center text-ui-base text-ink-4 py-10 px-6">
            {emptyMessage()}
            {/* What search covers, said only where a reader has just failed to find something. */}
            {searching && <div className="mt-2 text-ui-sm text-balance">{SEARCH_SCOPE_NOTE}</div>}
          </div>
        )}
      </div>
      {picker && (
        <ListMembershipPopover
          suttaId={picker.suttaId}
          anchor={picker.anchor}
          mobile={mobile}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}
