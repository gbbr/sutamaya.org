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
  // the pointer crosses row midpoints. Over Pointer Events, which touch browsers do fire, sharing
  // usePointerDragSession's window listeners and auto-scroll with the list-tree drag.
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

  // The popover is anchored to a rect captured at open, so anything that moves the rows under it
  // has to dismiss it: switching what the pane shows, entering reorder mode (where the control it
  // points at becomes a drag handle), or the pane being swapped away on mobile — LibraryPage hides
  // it with `display:none` rather than unmounting, which would leave a fixed-position popover
  // sitting over TreePane.
  useEffect(() => {
    setPicker(null);
  }, [nodeId, searching, reorderMode, visible]);

  useEffect(() => {
    setBlurbOpen(false);
  }, [nodeId]);

  // Runs after every render that could change the wrap: a new blurb, the clamp coming off, the pane
  // being resized or revealed. Compares the clamped height against the full one, so the "More"
  // affordance can never appear on text that already fits.
  useEffect(() => {
    const el = blurbRef.current;
    if (!el) {
      setBlurbOverflows(false);
      return;
    }
    setBlurbOverflows(blurbOpen || el.scrollHeight > el.clientHeight + 1);
  }, [nodeId, blurbOpen, paneW, visible, mobile]);

  // Removing suttas until one is left takes the header toggle away with them, so the mode has to
  // fall back off by itself or there is no way out of it.
  useEffect(() => {
    if (!canReorder) setReorderMode(false);
  }, [canReorder]);

  // Reveals the sutta the user came from: tapping a list-membership chip in the Reader opens this
  // pane with `selectedId` set. `block: 'nearest'` makes it a no-op when the row is already in
  // view, so it doesn't fight ordinary browsing.
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
  // What `nodeId` actually names, for the header and empty state below: a corpus row (and whether
  // that row expands rather than holding suttas), a user list (`currentList`), or — once a list has
  // been deleted — neither. `ready` is what tells "this account has no such list" from "the mirror
  // hasn't loaded yet"; without it a deep link to a list reads as deleted for the moment before its
  // own data arrives.
  const corpusNode = nodeId ? findNode(corpus, nodeId) : null;
  const expandableNode = !!corpusNode && isExpandable(corpusNode.node);
  const goneList = !!nodeId && !searching && ready && !currentList && !corpusNode;
  // The corpus node's description, skipped for a user list and while searching: neither is a corpus
  // node, and a list id could match one only by accident.
  const { blurb, from: blurbFrom } = searching || currentList ? { blurb: undefined, from: undefined } : nodeBlurb(corpus, nodeId);
  // The line under the pane's title: what it is showing, counted. Read off `corpus` here rather
  // than inside, since the `if (!corpus) return null` above doesn't narrow inside a nested
  // function.
  const collectionCount = corpus.nikayas.length;
  function metaLine(): string {
    if (!searching) {
      if (!nodeId) return `${collectionCount} collections`;
      // A list that is gone holds nothing rather than holding zero things, and "0 suttas" under a
      // blank title reads as an empty list rather than an absent one.
      if (goneList) return '';
      // An auto-list counts what the reader has, not what survived the cap: this line says how long
      // the list is, and the foot of the rows is where the shortfall is explained.
      return plural(currentList?.total ?? items.length, 'sutta');
    }
    // "suttas" rather than "results" whenever lists matched too, so the number names what it's
    // counting instead of implying it covers the whole pane, and the lists are counted beside it:
    // the block above the results is capped, so its own rows don't say how many matched.
    const noun = listHitTotal > 0 ? 'sutta' : 'result';
    // `hits` is uncapped, so a huge result set says "80+" rather than a number of rows nobody
    // is going to be shown.
    const suttas = hits.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+ ${noun}s` : plural(hits.length, noun);
    if (listHitTotal === 0) return suttas;
    // A query that matched lists and no suttas drops the "0 suttas" half rather than putting a
    // zero above a block that clearly isn't empty.
    const matchedLists = plural(listHitTotal, 'list');
    return hits.length === 0 ? matchedLists : `${suttas} · ${matchedLists}`;
  }
  const meta = metaLine();

  // The reorder toggle's colour treatment; its size and margins are on the button itself. Three
  // cases rather than two, because the two resting treatments differ by platform.
  function reorderToggleClass(): string {
    // Reorder mode is one you sit in, so it fills rather than tinting under the pointer, and
    // overrides both resting treatments below.
    if (reorderMode) return 'bg-accent2 text-[#FBFAF7]';
    // At rest on mobile it mirrors the back button beside it, bordered chip and all, so the header
    // reads icon / title / icon rather than a control at one edge and a bare glyph at the other.
    if (mobile) return 'border border-ink/[.12] bg-chip/40 text-ink-3 hover:text-ink active:bg-ink/[.08]';
    // At rest on desktop it's the same bare round icon button as the header controls beside the
    // account badge in TreePane — one icon-button vocabulary across both panes.
    return 'text-ink-3 hover:bg-ink/[.06]';
  }

  // The empty state under the rows.
  function emptyMessage(): string {
    // A search that found nothing — quoting the query back so it's clear what was looked for.
    if (searching) return `Nothing matches "${query}".`;
    // A corpus row that expands rather than holding suttas of its own — /browse/mn and the like.
    // Nothing in the UI links to one, but a typed or shared URL reaches it, and "Nothing here yet."
    // reads as "MN is empty" rather than "its suttas are a level down".
    if (expandableNode) return 'Choose a chapter to see its suttas.';
    // Named a list that has gone — deleted here, on another device, or a link that outlived it.
    // Every route to that is the same screen, deliberately: deleting the row being shown navigates
    // nowhere, so it explains itself where the reader is rather than moving them somewhere else.
    if (goneList) return 'This list is no longer here.';
    // A collection or list they picked that happens to hold nothing.
    if (nodeId) return 'Nothing here yet.';
    // Nothing selected at all — bare /browse, a first visit. Only the two-pane layout shows it,
    // since on mobile a first visit is showing the tree.
    return 'Choose a collection to begin.';
  }

  return (
    <section data-component="ListPane" className={`flex flex-col h-full min-w-0 ${mobile ? '' : 'bg-listpane'}`} style={{ flex: 1 }}>
      <header className="flex-none flex items-center gap-3.5 px-6 pt-5 pb-4 border-b border-ink/10">
        {mobile && (
          // The same round icon button as the reorder toggle on the right, so the header reads as
          // icon / title / icon. The border and chip fill are what make it read as a control at
          // rest, matching the pill toggle's thumb in TreePane's header. The `after`
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
            // The negative right margin pulls it in from the header's own 24px padding so its
            // centre lands on the 34px axis this pane's row controls sit on. Its colour treatment
            // is reorderToggleClass() above.
            className={`flex-none rounded-full flex items-center justify-center ${mobile ? 'w-[34px] h-[34px] -mr-[7px]' : 'w-[38px] h-[38px] -mr-[9px]'} ${reorderToggleClass()}`}
            aria-label={reorderMode ? 'Hide reorder handles' : 'Show reorder handles'}
            title={reorderMode ? 'Hide reorder handles' : 'Show reorder handles'}
            onClick={() => setReorderMode((m) => !m)}
          >
            {/* 16 on both, where the other header glyphs step up to 18–20 on desktop: this one
                is two arrows stacked, so it fills its own box top to bottom where a chevron or a
                magnifier leaves air, and matching their nominal size makes it read a size larger
                than all of them. */}
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
        {/* Matching lists, above the results — on desktop this pane is where results render, so
            it draws the block; on mobile TreePane does. */}
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
        {/* The node's description, above its suttas — the collection-page convention, and the
            only place it can go, since the group itself has no row of its own here. Inside the
            scroller rather than the header so a long one scrolls away instead of permanently
            eating the viewport.

            A wash and the rules above and below make it a block of its own, distinct from the
            rows and from the header's title. The lightest wash the app draws, and far below the
            selected-row tint (`bg-ink/[.06]`), which would read as a selection instead; neutral
            rather than a colour, so it darkens in light and lightens in dark.

            The eyebrow names what the description is about. A bare "About" means the page you're
            on; SN writes its descriptions on the saṁyutta, a level above the vagga rows that
            display them, so a borrowed one names that ancestor — "About SN12 · Causation". That
            stops a description of 90 discourses being passed off as a description of these ten,
            and it's the only place the page names the larger group it belongs to. Every borrowed
            case in the corpus is this one: an SN vagga under its saṁyutta.

            Clamped, because these are not short: 35 of the 92 run past 400 characters and SN
            22's is 2827 — six screens on a phone before the first row. Three lines, and the
            whole block toggles, so the target is the paragraph rather than a word at its foot.
            The affordance appears only when the text actually overflows, measured after layout
            rather than guessed from length — wrapping depends on pane width and type scale.

            `line-clamp-3` sets `display:-webkit-box`, so the expanded state has to restore
            `block` rather than the two being applied together — Tailwind emits `block` after the
            clamp, and the pair silently cancels the clamp out.

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
                  {/* Chrome, not content: neutral rather than the accent the app gives inline
                      text actions elsewhere (see SettingsPage). Partly because that accent is
                      the Pali subtitle colour on every row below, but mainly because this isn't
                      a link — the whole paragraph is the target and this only reports its state,
                      so promising "this word navigates" is wrong. Quieter than the paragraph
                      rather than louder, and the chevron is what tells it apart from the prose —
                      a direction, which is exactly what the control does. */}
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
          // Highlighted — a subtle tint plus a left accent stripe — only while searching, for the
          // hit TreePane's arrow-key nav has active, since that is what says which row Enter opens.
          // Nothing marks the URL's `selectedId`: browsing has no keyboard cursor, and the row is
          // revealed by scrolling to it.
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
              {/* The right gutter is only kept clear where a control actually sits. At rest the
                  add-to-list button is anchored to the top of the row, so only the title and the
                  Pali line beneath it give up the width — the blurb and chips run the row's full
                  measure. While reordering the grip is vertically centred instead, and the whole
                  row has to clear it. */}
              {/* No hover state: the rows are prose, and a wash passing under the pointer competes
                  with the description block above them, which is painted in the faintest tint the
                  app has. Nothing is lost on touch, which never had one. */}
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
                  // An em dash rather than a quote rule marks this as the reader's own note; a left
                  // rule would read as a passage quoted from the sutta.
                  <span className="flex gap-[7px] font-serif text-ui-md leading-[1.45] mt-[7px] text-ink-2">
                    <span aria-hidden className="flex-none text-ink-3">
                      —
                    </span>
                    {/* Clamped, like the blurb it stands in for: a row is a scannable line, not the
                        place to read a long note — the reader has the whole of it. */}
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
              {/* Opens the list-membership picker for this sutta. Hidden entirely while reordering
                  so the grip below has the gutter to itself — one control per row edge, never two,
                  and nobody manages memberships mid-drag. Held near the top of the row rather than
                  centred in it: a row runs three or four lines, so a centred button would float
                  alongside the blurb instead of reading as the row's own action. The `top` inset
                  matches the `right` one, so the circle sits the same distance from both edges of
                  its corner.

                  Held back at rest and brought up to full strength when the pointer is anywhere
                  over the row, or when the button takes keyboard focus: repeated down every row,
                  at full strength the icons read as a column running alongside the prose. The dim
                  itself sits inside `@media (hover: hover)`, so the control is never merely
                  hover-*revealed* — an iPad gets the desktop layout but has no hover, and one that
                  could only be restored by a pointer would simply not exist there.

                  Same bare round button as the header's reorder toggle and TreePane's header
                  icons — borderless at rest matters most here, where it's repeated down every
                  row: a chip fill and border would read as a column of buttons competing with the
                  text. The insets put its centre on the 34px axis the toggle and the grip share,
                  so nothing shifts sideways when reorder mode is turned on, and the rows reserve
                  `pr-14` for the width the circle actually takes. */}
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
                  // `right-3` puts this target's centre on the same 34px-from-the-edge axis as the
                  // header's reorder toggle and the add-to-list button it replaces, so nothing
                  // shifts sideways when reorder mode comes on. The target overhangs the rows'
                  // `pr-14` text column with empty space only; the grip glyph is 19px and stays
                  // inside it.
                  //
                  // `inset-y-1` rather than a fixed height: a row runs three or four lines, and
                  // grabbing one to drag is a gesture aimed at the row rather than at a 44px dot
                  // inside it. Spanning the full height makes the whole right gutter grabbable while
                  // the glyph stays centred, and nothing else sits in that gutter while reordering.
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
        {/* Why an auto-list stopped where it did, said at the foot of the rows because that is
            where the reader meets the boundary — a count in the header is read on the way in,
            before there is any question to answer. Centred and quiet: it is a footnote about the
            list, not another row in it. */}
        {currentList?.total !== undefined && currentList.total > items.length && (
          <div className="font-sans text-center text-ui-sm text-ink-4 py-6 px-6">
            Showing {items.length} of {currentList.total}
          </div>
        )}
        {/* A query that matched only lists isn't a failed search — the block above says so, and
            "Nothing matches" underneath it would contradict it. */}
        {items.length === 0 && !(searching && listHitTotal > 0) && (
          <div className="font-sans text-center text-ui-base text-ink-4 py-10 px-6">
            {emptyMessage()}
            {/* What was searched, said only where a reader has just failed to find something —
                which is where the limit actually matters. */}
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
