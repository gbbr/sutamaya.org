import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronLeft, GripVertical, List, ListPlus, Pencil } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { usePointerDragSession } from '../hooks/usePointerDragSession';
import { listItemsFor, nodeBlurb, nodeLabel, SEARCH_RESULTS_CAP, type SearchHit } from '../lib/corpus';
import { flattenListTree, suttaRowMeta } from '../lib/lists';
import { resolveDragReorder, type ItemMidpoint } from '../lib/listPaneDrag';
import { MatchedText } from './MatchedText';
import { SuttaRowChips } from './SuttaRowChips';
import { ListMembershipPopover } from './ListMembershipPopover';
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
  const { lists, membership, notes, highlights, reorderListItems } = useUserData();
  const { mobile, paneW } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>(`list:${query.trim() ? 'search' : nodeId || 'none'}`, visible);
  const itemRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const searching = query.trim().length > 0;
  // What the rows below mark up. Empty while browsing: this pane draws browse rows and search
  // results through the same map, and only a result has words worth marking.
  const rowQuery = searching ? query : '';
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

  // Reordering is only offered for a user list — an auto list's membership is derived rather than
  // stored — and only once it holds at least two suttas, since one row has nowhere to move to.
  const canReorder = !!currentList && !currentList.auto && items.length >= 2;

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
    () => suttaRowMeta(items.map(([id]) => id), membership, highlights, flatLists, currentList?.id),
    [items, membership, flatLists, highlights, currentList?.id]
  );

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
  // toggle for the list tree). Where the toggle appears at all is `canReorder` above.
  const [reorderMode, setReorderMode] = useState(false);
  // The row whose list-membership popover is open, with the screen-space rect of the control that
  // opened it. Held here rather than in the row so it outlives that row: unchecking the list
  // you're currently viewing drops the sutta out of `items`, and the popover has to stay up so it
  // can be checked straight back on.
  const [picker, setPicker] = useState<{ suttaId: string; anchor: DOMRect } | null>(null);
  // Whether the blurb above the rows is expanded past its 3-line clamp, and whether it has
  // anything to expand *to*. Measured after layout rather than derived from character count,
  // since where the text wraps depends on the pane width and the reader's type scale. Collapsed
  // again on every navigation — an expanded blurb is a decision about the page you're on.
  const [blurbOpen, setBlurbOpen] = useState(false);
  const [blurbOverflows, setBlurbOverflows] = useState(false);
  const blurbRef = useRef<HTMLDivElement | null>(null);
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

  // The popover is anchored to a rect captured at open, so anything that moves the rows out from
  // under it has to dismiss it: switching what the pane is showing, entering reorder mode (where
  // the control it points at is replaced by a drag handle), or the pane being swapped away on
  // mobile — LibraryPage hides it with `display:none` rather than unmounting, which on its own
  // would leave a fixed-position popover on screen over TreePane.
  useEffect(() => {
    setPicker(null);
  }, [nodeId, searching, reorderMode, visible]);

  useEffect(() => {
    setBlurbOpen(false);
  }, [nodeId]);

  // Runs after every render that could change the wrap: a new blurb, the clamp coming off, or
  // the pane being resized/revealed. Reads the clamped height against the full one, which is
  // what the clamp itself is doing — so the "More" affordance can never appear on text that
  // already fits.
  useEffect(() => {
    const el = blurbRef.current;
    if (!el) {
      setBlurbOverflows(false);
      return;
    }
    setBlurbOverflows(blurbOpen || el.scrollHeight > el.clientHeight + 1);
  }, [nodeId, blurbOpen, paneW, visible, mobile]);

  // Removing suttas until only one is left takes the header toggle away with them, so the mode
  // has to fall back off by itself or there'd be no visible way out of it.
  useEffect(() => {
    if (!canReorder) setReorderMode(false);
  }, [canReorder]);

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

  const title = searching
    ? { label: 'Search' }
    : nodeId
      ? nodeLabel(corpus, nodeId, lists)
      : { label: 'Library' };
  // The corpus node's description. Skipped for a user list and while searching — neither is a
  // corpus node, and a list id could collide with one only by accident.
  const { blurb, from: blurbFrom } = searching || currentList ? { blurb: undefined, from: undefined } : nodeBlurb(corpus, nodeId);
  const meta = searching
    ? hits.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+ results` : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`
    : !nodeId
      ? `${corpus.nikayas.length} collections`
      : `${items.length} sutta${items.length === 1 ? '' : 's'}`;

  return (
    <section data-component="ListPane" className={`flex flex-col h-full min-w-0 ${mobile ? '' : 'bg-listpane'}`} style={{ flex: 1 }}>
      <header className="flex-none flex items-center gap-3.5 px-6 pt-5 pb-4 border-b border-ink/10">
        {mobile && (
          // Deliberately the same round icon button as the reorder toggle on the right, so the
          // header reads as icon / title / icon. The border and chip fill are what make it read
          // as a control at rest — an unfilled grey chevron doesn't — and match the pill toggle's
          // thumb in TreePane's header. The `after` pseudo-element pads the tap target out to
          // ~44px without growing the circle or shifting anything else in the flex row.
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
            // On desktop this is the same bare round icon button as the header controls beside
            // the account badge in TreePane — one icon-button vocabulary across both panes.
            // Mobile is the exception: it mirrors the back button beside it instead, bordered
            // chip and all, so the header reads icon / title / icon rather than a control at one
            // edge and a bare glyph at the other.
            //
            // Either way the negative right margin pulls it in from the header's own 24px padding
            // so its centre lands on the 34px axis this pane's row controls sit on.
            //
            // Reorder mode is a mode you're left sitting in, so it fills rather than merely
            // tinting under the pointer — that state overrides both resting treatments.
            className={`flex-none rounded-full flex items-center justify-center ${mobile ? 'w-[34px] h-[34px] -mr-[7px]' : 'w-[38px] h-[38px] -mr-[9px]'} ${
              reorderMode
                ? 'bg-accent2 text-[#FBFAF7]'
                : mobile
                  ? 'border border-ink/[.12] bg-chip/40 text-ink-3 hover:text-ink active:bg-ink/[.08]'
                  : 'text-ink-3 hover:bg-ink/[.06]'
            }`}
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
            <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">
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
          // Highlighted (subtle tint + left accent stripe) only while searching, for the hit
          // TreePane's arrow-key nav currently has active (see activeId's own comment) — that
          // highlight is what says which row Enter opens. Nothing marks the URL's `selectedId`:
          // browsing has no keyboard cursor to show, and the row is revealed by scrolling to it.
          const on = searching && id === activeId;
          const note = notes[id];
          const { chips, hlCount } = rowMeta.get(id) ?? { chips: [], hlCount: 0 };
          const dragging = dragIdRef.current === id;
          const reordering = canReorder && reorderMode;
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
                  // The icon, not a quote rule, is what marks this as the reader's own note: a
                  // left rule reads as a passage quoted from the sutta. Nudged down a little so it
                  // sits on the first line's x-height rather than its ascenders.
                  <span className="flex gap-[7px] font-serif text-ui-md leading-[1.45] mt-[7px] text-ink-2">
                    <Pencil size={14} strokeWidth={2} className="flex-none mt-[4px] text-ink-3" />
                    {/* Clamped, like the blurb it stands in for: a row is a scannable line, not the
                        place to read a long note — the reader has the whole of it. */}
                    <span className="line-clamp-3">
                      <MatchedText text={note} query={rowQuery} />
                    </span>
                  </span>
                ) : (
                  // No `block` alongside `line-clamp-3`: the clamp sets `display:-webkit-box` and
                  // Tailwind emits it before `.block`, so `block` would silently win.
                  <span className="text-ui-md leading-[1.5] mt-1.5 text-ink-2 line-clamp-3">
                    <MatchedText text={s.blurb} query={rowQuery} />
                  </span>
                )}
                <SuttaRowChips chips={chips} hlCount={hlCount} />
              </button>
              {/* Opens the list-membership picker for this sutta. Hidden entirely while reordering
                  so the grip below has the gutter to itself — one control per row edge, never two,
                  and nobody manages memberships mid-drag. Held near the top of the row rather than
                  centred in it: a row runs three or four lines, so a centred button would float
                  alongside the blurb instead of reading as the row's own action. The `top` inset
                  matches the `right` one, so the circle sits the same distance from both edges of
                  its corner. Visible at rest on every device, never hover-revealed: an iPad gets
                  the desktop layout but has no hover, so a hover-gated control would simply not
                  exist there.

                  Same bare round button as the header's reorder toggle and TreePane's header
                  icons — borderless at rest matters most here, where it's repeated down every
                  row: a chip fill and border would read as a column of buttons competing with the
                  text. The insets put its centre on the 34px axis the toggle and the grip share,
                  so nothing shifts sideways when reorder mode is turned on, and the rows reserve
                  `pr-14` for the width the circle actually takes. */}
              {!reordering && (
                <button
                  className={`absolute ${mobile ? 'right-3 top-3 w-11 h-11' : 'right-[15px] top-[15px] w-[38px] h-[38px]'} flex items-center justify-center rounded-full text-ink-3 hover:bg-ink/[.06] active:bg-ink/[.10]`}
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
                  // shifts sideways when reorder mode is turned on. The target overhangs the rows'
                  // `pr-14` text column, but only with empty space — the grip glyph itself is 19px
                  // and stays well inside it.
                  //
                  // `inset-y-1` rather than a fixed height: a row runs three or four lines, and
                  // grabbing one to drag it is a gesture aimed at the *row*, not at a 44px dot
                  // inside it. Spanning the row's full height makes the whole right gutter grabbable
                  // while the glyph stays centred, which matters most on touch — there is nothing
                  // else to hit in that gutter while reordering, so there is nothing to steal from.
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
        {items.length === 0 && (
          <div className="font-sans text-center text-ui-base text-ink-4 py-10 px-6">
            {/* Nothing selected at all (bare /browse — a first visit) is waiting on the reader;
                "Nothing here yet." is a statement about a thing they already picked, and saying
                it here would read as a failure. Only the two-pane layout ever shows this one,
                since on mobile a first visit is showing the tree. */}
            {searching
              ? `Nothing matches "${query}".`
              : nodeId
                ? 'Nothing here yet.'
                : 'Choose a collection to begin.'}
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
