import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '@reach/router';
import {
  Settings,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
  Highlighter,
  StickyNote,
  GripVertical,
  ArrowUpDown,
  Library,
  List,
} from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { useScrollToNode } from '../hooks/useScrollToNode';
import { SEARCH_INPUT_ID } from '../hooks/useListNav';
import { findNode, isExpandable, searchCorpus } from '../lib/corpus';
import { HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID } from '../lib/autoLists';
import { autoScrollEdge } from '../lib/dragAutoScroll';
import type { ChapterRow, Corpus, ListDef } from '../lib/types';

// One row of the nested chapter/group/category tree under a nikaya — recurses arbitrarily
// deep (SN: group > chapter > category; AN: chapter > category; MN: category directly).
function TreeRow({
  node,
  depth,
  nodeId,
  expanded,
  onToggle,
  onSelect,
}: {
  node: ChapterRow;
  depth: number;
  nodeId?: string;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const expandable = isExpandable(node);
  const open = !!expanded[node.id];
  return (
    <div>
      <button
        data-node-id={node.id}
        className={`row flex items-start gap-[9px] w-full text-left pr-[18px] py-[9px] border-b border-ink/[.07] ${nodeId === node.id ? 'bg-ink/[.06]' : ''}`}
        style={{ paddingLeft: 18 + depth * 14 }}
        onClick={() => (expandable ? onToggle(node.id) : onSelect(node.id))}
      >
        <span className="w-[11px] flex-none flex items-center justify-center text-ink/40 mt-[4px]">
          {expandable ? (
            open ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )
          ) : (
            <ChevronRight size={12} strokeWidth={2} className="text-ink/35" />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span>
            <span className="font-sans text-[13px] font-bold text-ink/45 mr-2">{node.ref}</span>
            <span className="text-[15px] font-semibold leading-[1.3]">{node.label}</span>
          </span>
          {node.sub && <span className="block font-serif text-[13px] italic text-accent mt-[1px]">{node.sub}</span>}
          <span className="block font-sans text-[13px] text-ink/45 mt-[2px]">
            {node.count} sutta{node.count === 1 ? '' : 's'}
          </span>
        </span>
      </button>
      {expandable &&
        open &&
        node.chapters!.map((c) => (
          <TreeRow key={c.id} node={c} depth={depth + 1} nodeId={nodeId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
        ))}
    </div>
  );
}

type DropZone = 'before' | 'after' | 'inside';

// One row of the "My lists" tree — a list can nest other lists as children (folder-like), with
// button-based rename/delete/move controls that always work (touch included), plus Pointer
// Events drag-and-drop reordering/nesting when "reorder mode" (see the toggle by "My lists") is
// on. The drag surface is a dedicated handle on the row's left edge (icon + generous invisible
// padding, ~44px touch target), not the whole row — an earlier version made the entire row
// touchAction:none while in reorder mode, which also blocked vertical scrolling of the list
// pane itself (you couldn't scroll past a row without dragging it) and needed userSelect:none
// smeared across the whole row to stop text selection. Confining touchAction/userSelect to the
// handle keeps the rest of the row (title, member count, options button) scrollable and
// selectable as normal, matching ListPane's sutta-reorder grip. A press-and-drag on the handle
// engages once it clears a small movement threshold (a plain tap still reaches the handle's
// no-op — nothing else lives there — harmlessly). Dropping on the top/bottom quarter of a row
// reorders as a sibling, the middle half nests it as a child (see TreePane's updateDropTarget
// for the zone math).
function ListRow({
  list,
  depth,
  nodeId,
  childrenOf,
  totalMembers,
  listExpanded,
  onToggle,
  onSelect,
  menuOpenId,
  onToggleMenu,
  editingId,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
  onArmDelete,
  confirmDeleteId,
  onCancelDelete,
  onMove,
  onAddChild,
  creatingParentId,
  draft,
  onDraftChange,
  onDraftKey,
  draftInputRef,
  siblingIndex,
  siblingCount,
  reorderMode,
  dragId,
  overId,
  overZone,
  onRowPointerDown,
  registerRowEl,
}: {
  list: ListDef;
  depth: number;
  nodeId?: string;
  childrenOf: (parentId: string) => ListDef[];
  // Distinct sutta count across a list's own `items` plus every descendant sub-list's `items`,
  // deduped (the same sutta can independently belong to a parent and a child list) — see
  // `listMemberSets` below for how it's computed.
  totalMembers: (id: string) => number;
  listExpanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  menuOpenId: string | null;
  onToggleMenu: (id: string) => void;
  editingId: string | null;
  editDraft: string;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (l: ListDef) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (l: ListDef) => void;
  onArmDelete: (l: ListDef) => void;
  confirmDeleteId: string | null;
  onCancelDelete: () => void;
  onMove: (l: ListDef, dir: -1 | 1) => void;
  onAddChild: (parentId: string) => void;
  creatingParentId: string | null | undefined;
  draft: string;
  onDraftChange: (v: string) => void;
  onDraftKey: (e: KeyboardEvent<HTMLInputElement>) => void;
  draftInputRef: (el: HTMLInputElement | null) => void;
  siblingIndex: number;
  siblingCount: number;
  reorderMode: boolean;
  dragId: string | null;
  overId: string | null;
  overZone: DropZone | null;
  onRowPointerDown: (e: React.PointerEvent, id: string) => void;
  registerRowEl: (id: string, el: HTMLElement | null) => void;
}) {
  const kids = childrenOf(list.id);
  const hasKids = kids.length > 0;
  const open = !!listExpanded[list.id];
  const editing = editingId === list.id;
  const menuOpen = menuOpenId === list.id;
  const dragging = dragId === list.id;
  const isOver = overId === list.id && dragId !== list.id;

  return (
    <div>
      <div
        ref={(el) => registerRowEl(list.id, el)}
        data-node-id={list.id}
        className={`row flex items-center gap-[7px] w-full text-left pr-[10px] py-[7px] border-b border-ink/[.07] ${nodeId === String(list.id) ? 'bg-ink/[.06]' : ''}`}
        style={{
          paddingLeft: 18 + depth * 14,
          opacity: dragging ? 0.4 : 1,
          background: isOver && overZone === 'inside' ? 'rgba(138,106,59,.16)' : undefined,
          boxShadow: isOver && overZone === 'before' ? 'inset 0 2px 0 #8A6A3B' : isOver && overZone === 'after' ? 'inset 0 -2px 0 #8A6A3B' : undefined,
        }}
      >
        {reorderMode && (
          <span
            className="flex-none flex items-center justify-center text-ink/35 -my-[7px] -ml-1.5"
            style={{
              width: 40,
              alignSelf: 'stretch',
              cursor: 'grab',
              // Scoped to just this handle (not the whole row, see the comment above) — blocks
              // the browser's own scroll/text-selection/long-press-callout gestures from
              // hijacking a press here before our own threshold-based drag detection engages,
              // without affecting touch/scroll/selection anywhere else on the row.
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
            onPointerDown={(e) => onRowPointerDown(e, list.id)}
          >
            <GripVertical size={13} strokeWidth={2} />
          </span>
        )}
        <button
          className="w-[19px] -ml-1 flex-none flex items-center justify-center text-ink/70 hover:text-ink"
          onClick={() => hasKids && onToggle(list.id)}
        >
          {hasKids ? open ? <ChevronDown size={14} strokeWidth={2.25} /> : <ChevronRight size={14} strokeWidth={2.25} /> : null}
        </button>
        {editing ? (
          <input
            autoFocus
            value={editDraft}
            onChange={(e) => onEditDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitEdit();
              } else if (e.key === 'Escape') onCancelEdit();
            }}
            onBlur={onCommitEdit}
            className="flex-1 min-w-0 h-[26px] border border-accent rounded px-1.5 bg-field text-[14.5px] outline-none"
          />
        ) : (
          <button
            className="flex-1 min-w-0 text-left text-[15px] font-semibold truncate py-[2px]"
            onClick={() => {
              onSelect(String(list.id));
              if (hasKids && !open) onToggle(list.id);
            }}
          >
            {list.label}
          </button>
        )}
        {!editing && (
          <span className="flex-none font-sans text-[11.5px] font-medium text-ink/50">{totalMembers(list.id)}</span>
        )}
        {!editing && (
          <button
            className="flex-none w-[20px] h-[20px] flex items-center justify-center rounded text-ink/40 hover:bg-ink/[.08] hover:text-ink"
            title="List options"
            onClick={() => onToggleMenu(list.id)}
          >
            <MoreHorizontal size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      {confirmDeleteId === list.id ? (
        <div className="flex items-center gap-2 pr-[18px] pb-[7px] pt-[2px]" style={{ paddingLeft: 18 + depth * 14 + 11 }}>
          <span className="font-sans text-[12px] text-ink/60">Delete "{list.label}"?</span>
          <button
            onClick={() => onDelete(list)}
            className="font-sans text-[12px] font-semibold px-2 py-[3px] rounded border border-red-600/40 text-red-600 hover:bg-red-600/10"
          >
            Delete
          </button>
          <button onClick={onCancelDelete} className="font-sans text-[12px] px-2 py-[3px] rounded border border-ink/[.18] text-ink/55 hover:bg-ink/[.08]">
            Cancel
          </button>
        </div>
      ) : (
        menuOpen &&
        !editing && (
          <div className="flex items-center gap-[6px] pr-[18px] pb-[7px] pt-[2px]" style={{ paddingLeft: 18 + depth * 14 + 11 }}>
            <button
              title="Move up"
              disabled={siblingIndex === 0}
              onClick={() => onMove(list, -1)}
              className="w-[24px] h-[22px] flex items-center justify-center rounded border border-ink/[.18] text-ink/55 hover:bg-ink/[.08] disabled:opacity-25"
            >
              <ChevronUp size={13} strokeWidth={2} />
            </button>
            <button
              title="Move down"
              disabled={siblingIndex === siblingCount - 1}
              onClick={() => onMove(list, 1)}
              className="w-[24px] h-[22px] flex items-center justify-center rounded border border-ink/[.18] text-ink/55 hover:bg-ink/[.08] disabled:opacity-25"
            >
              <ChevronDown size={13} strokeWidth={2} />
            </button>
            <button
              title="New sub-list"
              onClick={() => onAddChild(list.id)}
              className="w-[24px] h-[22px] flex items-center justify-center rounded border border-ink/[.18] text-ink/55 hover:bg-ink/[.08]"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
            <button
              title="Rename"
              onClick={() => onStartEdit(list)}
              className="w-[24px] h-[22px] flex items-center justify-center rounded border border-ink/[.18] text-ink/55 hover:bg-ink/[.08]"
            >
              <Pencil size={12} strokeWidth={2} />
            </button>
            <button
              title="Delete"
              onClick={() => onArmDelete(list)}
              className="w-[24px] h-[22px] flex items-center justify-center rounded border border-ink/[.18] text-ink/55 hover:bg-red-600/10 hover:text-red-600"
            >
              <Trash2 size={12} strokeWidth={2} />
            </button>
          </div>
        )
      )}
      {hasKids &&
        open &&
        kids.map((k, idx) => (
          <ListRow
            key={k.id}
            list={k}
            depth={depth + 1}
            nodeId={nodeId}
            childrenOf={childrenOf}
            totalMembers={totalMembers}
            listExpanded={listExpanded}
            onToggle={onToggle}
            onSelect={onSelect}
            menuOpenId={menuOpenId}
            onToggleMenu={onToggleMenu}
            editingId={editingId}
            editDraft={editDraft}
            onEditDraftChange={onEditDraftChange}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onDelete={onDelete}
            onArmDelete={onArmDelete}
            confirmDeleteId={confirmDeleteId}
            onCancelDelete={onCancelDelete}
            onMove={onMove}
            onAddChild={onAddChild}
            creatingParentId={creatingParentId}
            draft={draft}
            onDraftChange={onDraftChange}
            onDraftKey={onDraftKey}
            draftInputRef={draftInputRef}
            siblingIndex={idx}
            siblingCount={kids.length}
            reorderMode={reorderMode}
            dragId={dragId}
            overId={overId}
            overZone={overZone}
            onRowPointerDown={onRowPointerDown}
            registerRowEl={registerRowEl}
          />
        ))}
      {creatingParentId === list.id && (
        <div className="pr-[18px] pt-1 pb-2" style={{ paddingLeft: 18 + (depth + 1) * 14 }}>
          <input
            ref={draftInputRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onDraftKey}
            onBlur={() => onDraftKey({ key: 'Escape' } as KeyboardEvent<HTMLInputElement>)}
            placeholder="Sub-list name — return to create"
            className="w-full h-[32px] border border-accent rounded-lg px-2.5 bg-field text-[14px] outline-none"
          />
        </div>
      )}
    </div>
  );
}

interface TreePaneProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  onOpenSutta: (suttaId: string) => void;
  onSearch: (query: string) => void;
  query: string;
  activeIndex: number;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
}

// The set of ancestor ids (nikaya > group > chapter > category, as deep as it goes) that need
// to be open for `nodeId` to be visible in the tree.
function ancestorsOf(corpus: Corpus | null, nodeId: string | undefined): Record<string, boolean> {
  if (!corpus || !nodeId) return {};
  const found = findNode(corpus, nodeId);
  if (found?.kind !== 'chapter' || !found.ancestors.length) return {};
  const init: Record<string, boolean> = {};
  for (const a of found.ancestors) init[a.id] = true;
  return init;
}

// Same idea as ancestorsOf, for the "My lists" tree: every ancestor list id (by `parentId`
// chain) that needs to be open for `nodeId` — a list itself, e.g. from a membership chip's
// /browse/{list_id} navigation — to be visible, plus `nodeId` itself so a list deep-linked (or
// selected) directly shows its own children rather than just being highlighted shut.
function ancestorsOfList(lists: ListDef[], nodeId: string | undefined): Record<string, boolean> {
  if (!nodeId) return {};
  const init: Record<string, boolean> = {};
  let cur = lists.find((l) => l.id === nodeId);
  if (cur) init[cur.id] = true;
  while (cur?.parentId) {
    init[cur.parentId] = true;
    cur = lists.find((l) => l.id === cur!.parentId);
  }
  return init;
}

export function TreePane({ nodeId, onSelect, onOpenSutta, onSearch, query, activeIndex, visible = true }: TreePaneProps) {
  const { corpus } = useCorpus();
  const { lists, notes, createList, renameList, removeList, reorderLists, setListParent } = useUserData();
  const { user, promptGoogleSignIn } = useAuth();
  const { mobile, desktop, paneW } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>('tree', visible);
  // Computed synchronously on mount (not via an effect) so the tree is *already* expanded to
  // nodeId by the very first render — otherwise useScrollMemory's restore (a layout effect,
  // which always runs before any passive effect) would fire against a still-collapsed tree
  // whenever TreePane mounts fresh already pointed at a deep node (e.g. LibraryPage remounting
  // after the reader closes, on desktop where it's always "visible" so that restore-on-visible
  // fallback never kicks in either), silently clamping the restored scroll offset back to 0.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ancestorsOf(corpus, nodeId));
  // Library and My Lists used to share one scrolling column, with My Lists always below the
  // (often long) nikaya tree — effectively inaccessible without a lot of scrolling for anyone
  // who mainly lives in one or the other. This switches the pane between full views of each
  // instead, persisted like the rest of this pane's layout prefs. Signed-out users have no lists
  // to switch to, so they're pinned to 'library' regardless of what's stored.
  const [paneView, setPaneView] = useState<'library' | 'lists'>(() => {
    try {
      return localStorage.getItem('sutamaya.treeView') === 'lists' ? 'lists' : 'library';
    } catch {
      return 'library';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('sutamaya.treeView', paneView);
    } catch {
      // storage unavailable — ignore
    }
  }, [paneView]);
  const effectiveView = user ? paneView : 'library';

  // A membership chip's /browse/{list_id} navigation (or any other deep link to a list) needs
  // the "My lists" tree actually showing for that row to be visible at all — flip the toggle for
  // the user rather than landing them on a Library view with nothing selected. Symmetrically, a
  // breadcrumb segment's /browse/{corpus_node_id} navigation (or any other deep link into the
  // browse tree) needs to flip back to 'library' — otherwise a user who navigates there while
  // "My lists" is showing ends up on a list view with nothing selected instead.
  // Depend on whether nodeId *is* a list id, not on the `lists` array itself — reordering or
  // re-parenting a list (drag-and-drop in ListRow) gives `lists` a new reference without adding
  // or removing any id, and re-running this on that reference change alone snapped the pane back
  // to 'library' immediately after every mobile drag-drop (nodeId, still a corpus node id from
  // whatever the user was last browsing, would hit the `else if` branch below).
  const nodeIsListId = lists.some((l) => l.id === nodeId);
  useEffect(() => {
    if (!user || !nodeId) return;
    if (nodeIsListId) setPaneView('lists');
    else if (corpus && findNode(corpus, nodeId)) setPaneView('library');
  }, [user, nodeId, nodeIsListId, corpus]);

  // Expands every ancestor level of the current node whenever nodeId *changes* after mount —
  // covers deep links and search-driven navigation within an already-mounted TreePane, without
  // collapsing anything the user already had open.
  useEffect(() => {
    const toOpen = ancestorsOf(corpus, nodeId);
    if (!Object.keys(toOpen).length) return;
    setExpanded((x) => {
      let changed = false;
      const next = { ...x };
      for (const id of Object.keys(toOpen)) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : x;
    });
  }, [corpus, nodeId]);

  // Same as above, for the "My lists" tree.
  useEffect(() => {
    const toOpen = ancestorsOfList(lists, nodeId);
    if (!Object.keys(toOpen).length) return;
    setListExpanded((x) => {
      let changed = false;
      const next = { ...x };
      for (const id of Object.keys(toOpen)) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : x;
    });
  }, [lists, nodeId]);

  function toggleExpanded(id: string) {
    setExpanded((x) => ({ ...x, [id]: !x[id] }));
  }
  // `undefined` = no draft input open; `null` = creating a top-level list; a list id = creating
  // a sub-list under that list.
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  // Synchronous initial state for the same reason `expanded` above is: so the tree is already
  // expanded to nodeId on the very first render if TreePane mounts fresh already pointed at a
  // nested list.
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>(() => ancestorsOfList(lists, nodeId));
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overZone, setOverZone] = useState<DropZone | null>(null);
  const listInput = useRef<HTMLInputElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const hitRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Pointer Events drive the list-tree drag (mirrors ListPane's sutta-reorder drag, so touch
  // works the same way here too — HTML5 drag-and-drop doesn't fire reliably on touch browsers).
  // These all need to be refs, not just state: onRowPointerDown registers its window-level
  // pointermove/pointerup listeners once, at drag-start — unlike a JSX-bound handler (re-bound
  // fresh every render), that one listener keeps calling the *same* closure for the rest of the
  // drag, so anything it reads via a plain state variable would see whatever that variable's
  // value was back at drag-start, not later updates. `overIdRef`/`overZoneRef` mirror the
  // `overId`/`overZone` state (kept only for rendering the drop-target highlight) so
  // finishTreeDrag reads the live values instead of a stale snapshot.
  const rowElRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);
  const overZoneRef = useRef<DropZone | null>(null);
  const pointerYRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // Set for the duration of a candidate/active drag so an unmount mid-drag can tear down the
  // window-level listeners it registered — see the effect below.
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const listChildrenOf = useMemo(() => {
    const byParent = new Map<string | null, ListDef[]>();
    for (const l of lists) {
      const key = l.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(l);
    }
    return (parentId: string) => byParent.get(parentId) || [];
  }, [lists]);
  // Total distinct sutta count for a list, "just like the library entries" (ChapterRow's
  // `node.count`) but computed here at render time rather than baked into corpus.json, since a
  // user list's `items` (and its sub-lists') can change at any moment. Recurses through
  // `listChildrenOf` and unions each level's `items` into a Set — the same sutta can
  // independently belong to a parent list and one of its sub-lists (or two sibling sub-lists),
  // so a plain sum across levels would double-count; a dedup'd Set is the "how many distinct
  // suttas" the badge is meant to show.
  const listMemberSets = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l] as const));
    const cache = new Map<string, Set<string>>();
    function collect(id: string): Set<string> {
      const cached = cache.get(id);
      if (cached) return cached;
      const set = new Set<string>(byId.get(id)?.items || []);
      cache.set(id, set);
      for (const child of listChildrenOf(id)) {
        for (const memberId of collect(child.id)) set.add(memberId);
      }
      return set;
    }
    for (const l of lists) collect(l.id);
    return cache;
  }, [lists, listChildrenOf]);
  const listTotalMembers = (id: string) => listMemberSets.get(id)?.size ?? 0;
  const topLevelLists = useMemo(() => lists.filter((l) => !l.parentId && !l.auto), [lists]);
  const autoLists = useMemo(
    () =>
      [
        { list: lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID), sub: 'Every sutta with a highlight', Icon: Highlighter },
        { list: lists.find((l) => l.id === NOTES_AUTO_LIST_ID), sub: 'Every sutta with a note', Icon: StickyNote },
      ].filter((x): x is { list: ListDef; sub: string; Icon: typeof Highlighter } => !!x.list),
    [lists]
  );

  function toggleListExpanded(id: string) {
    setListExpanded((x) => ({ ...x, [id]: !x[id] }));
  }

  function toggleListMenu(id: string) {
    setMenuOpenId((m) => (m === id ? null : id));
  }

  function startEditList(l: ListDef) {
    setMenuOpenId(null);
    setEditingId(l.id);
    setEditDraft(l.label);
  }

  function commitEditList() {
    const id = editingId;
    const text = editDraft.trim();
    setEditingId(null);
    if (!id) return;
    if (text) renameList(id, text);
  }

  function cancelEditList() {
    setEditingId(null);
  }

  function armDeleteList(l: ListDef) {
    setMenuOpenId(null);
    setConfirmDeleteId(l.id);
  }

  function cancelDeleteList() {
    setConfirmDeleteId(null);
  }

  function deleteList(l: ListDef) {
    setConfirmDeleteId(null);
    removeList(l.id);
  }

  function addChildList(parentId: string) {
    setMenuOpenId(null);
    setListExpanded((x) => ({ ...x, [parentId]: true }));
    setCreatingParentId(parentId);
    setDraft('');
    setTimeout(() => listInput.current?.focus(), 30);
  }

  function moveList(l: ListDef, dir: -1 | 1) {
    const scoped = l.parentId ? listChildrenOf(l.parentId) : topLevelLists;
    const idx = scoped.findIndex((s) => s.id === l.id);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= scoped.length) return;
    const order = scoped.map((s) => s.id);
    [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
    reorderLists(l.parentId ?? null, order);
  }

  // True if `candidateId` sits somewhere underneath `ofId` in the list tree — dropping `ofId`
  // onto (or as a new sibling within) a descendant of itself would create a cycle, so every drop
  // handler checks this first regardless of zone.
  function isDescendant(candidateId: string, ofId: string): boolean {
    let cur = lists.find((l) => l.id === candidateId);
    while (cur?.parentId) {
      if (cur.parentId === ofId) return true;
      cur = lists.find((l) => l.id === cur!.parentId);
    }
    return false;
  }

  function siblingIdsWithInsert(parentId: string | null, insertId: string, targetId: string, after: boolean): string[] {
    const scoped = (parentId ? listChildrenOf(parentId) : topLevelLists).map((s) => s.id).filter((id) => id !== insertId);
    const targetIdx = scoped.indexOf(targetId);
    scoped.splice(after ? targetIdx + 1 : targetIdx, 0, insertId);
    return scoped;
  }

  function registerRowEl(id: string, el: HTMLElement | null) {
    if (el) rowElRefs.current.set(id, el);
    else rowElRefs.current.delete(id);
  }

  // Which row (if any) the pointer currently sits vertically over, and which third of it —
  // top/bottom quarter reorders as a sibling, the middle half nests as a child. Hit-tests by
  // rect instead of relying on native dragover targeting, since a window-level pointermove
  // listener (see onRowPointerDown) doesn't know which row DOM-wise the pointer is above.
  function updateDropTarget() {
    const draggedId = dragIdRef.current;
    if (!draggedId) return;
    const y = pointerYRef.current;
    const candidates: { id: string; zone: DropZone }[] = [];
    rowElRefs.current.forEach((el, rowId) => {
      if (rowId === draggedId) return;
      const rect = el.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) return;
      const ratio = (y - rect.top) / rect.height;
      candidates.push({ id: rowId, zone: ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside' });
    });
    const next = candidates[0] ?? null;
    overIdRef.current = next?.id ?? null;
    overZoneRef.current = next?.zone ?? null;
    setOverId(next?.id ?? null);
    setOverZone(next?.zone ?? null);
  }

  function runTreeDragLoop() {
    function tick() {
      if (!dragIdRef.current) {
        rafRef.current = null;
        return;
      }
      autoScrollEdge(scrollRef.current, pointerYRef.current);
      updateDropTarget();
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function commitDrop(draggedId: string, target: ListDef, zone: DropZone) {
    const dragged = lists.find((l) => l.id === draggedId);
    if (!dragged || isDescendant(target.id, draggedId)) return;
    if (zone === 'inside') {
      if (dragged.parentId !== target.id) await setListParent(draggedId, target.id);
      setListExpanded((x) => ({ ...x, [target.id]: true }));
      return;
    }
    const newParentId = target.parentId ?? null;
    if (dragged.parentId !== newParentId) await setListParent(draggedId, newParentId);
    const order = siblingIdsWithInsert(newParentId, draggedId, target.id, zone === 'after');
    await reorderLists(newParentId, order);
  }

  function finishTreeDrag() {
    const draggedId = dragIdRef.current;
    const targetId = overIdRef.current;
    const zone = overZoneRef.current;
    dragIdRef.current = null;
    overIdRef.current = null;
    overZoneRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setDragId(null);
    setOverId(null);
    setOverZone(null);
    if (!draggedId || !targetId || draggedId === targetId || !zone) return;
    const target = lists.find((l) => l.id === targetId);
    if (!target) return;
    void commitDrop(draggedId, target, zone);
  }

  // Only engages a drag once the pointer clears a small movement threshold — a plain tap (no
  // movement) reaches the row's own button clicks (select/rename/delete/menu) normally, since
  // nothing here calls preventDefault or pointer-capture until a real drag is underway. Tracked
  // via window-level listeners (not this row's own onPointerMove) so a fast initial move that
  // carries the pointer off the starting row before the threshold trips still keeps tracking it.
  function onRowPointerDown(e: React.PointerEvent, id: string) {
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let engaged = false;

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      if (!engaged) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        engaged = true;
        dragIdRef.current = id;
        setDragId(id);
        runTreeDragLoop();
      }
      pointerYRef.current = ev.clientY;
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      activeDragCleanupRef.current = null;
      if (engaged) finishTreeDrag();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    activeDragCleanupRef.current = onUp;
  }

  // Tears down a still-active drag's window listeners (and any live rAF loop) if TreePane
  // unmounts mid-drag (e.g. navigating to Settings while dragging) — without this the listeners
  // added in onRowPointerDown above would never be removed.
  useEffect(() => {
    return () => {
      activeDragCleanupRef.current?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (corpus && searching ? searchCorpus(corpus, query, notes) : []), [corpus, query, searching, notes]);

  useEffect(() => {
    if (searching && activeIndex >= 0) hitRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, searching]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === '/') {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      } else if (e.key.toLowerCase() === 'x' && user) {
        e.preventDefault();
        setPaneView((v) => (v === 'library' ? 'lists' : 'library'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);

  // The target row (corpus chapter or list) often isn't in the DOM yet on the same render
  // nodeId changed on — the ancestor-expand effects above (and, for a list, the paneView switch
  // above) still need to run and re-render first — so this retries on each of their state
  // changes until the row is actually findable, not just once.
  useScrollToNode(scrollRef, nodeId, [effectiveView, expanded, listExpanded, corpus, lists]);

  if (!corpus) return null;

  const style = mobile
    ? { flex: 1 }
    : { flex: 'none', width: paneW.tree, background: '#F0ECE4' };

  async function submitDraft() {
    const name = draft.trim();
    const parentId = creatingParentId ?? null;
    setCreatingParentId(undefined);
    setDraft('');
    if (!name) return;
    try {
      const list = await createList(name, parentId);
      navigate(`/browse/${list.id}`);
    } catch {
      // Signed out: createList() already triggered the Google sign-in prompt.
    }
  }

  function onDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDraft();
    } else if (e.key === 'Escape') {
      setCreatingParentId(undefined);
      setDraft('');
    }
  }

  const signedInBadge = user ? (
    <button
      className="flex-none w-[22px] h-[22px] rounded-full overflow-hidden border border-ink/[.18] flex items-center justify-center bg-accent/15 font-sans text-[10px] font-semibold text-accent"
      title={`Signed in as ${user.email}`}
      onClick={() => navigate('/settings')}
    >
      {user.picture ? (
        <img src={user.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        user.email[0]?.toUpperCase()
      )}
    </button>
  ) : (
    // Google's own rendered "icon" button (google.accounts.id.renderButton with type: 'icon')
    // has an unpredictable natural size that doesn't fit cleanly into a 22px badge — at small
    // sizes it clips down to what reads as a blank white circle. This is deliberately just a
    // plain button showing Google's "G" mark, wired to `promptGoogleSignIn` (which navigates to
    // Settings — see the comment on it in AuthContext.tsx for why sign-in itself has to happen
    // from a real, full-size rendered button there rather than inline here).
    <button
      className="flex-none w-[22px] h-[22px] rounded-full border border-ink/[.18] flex items-center justify-center hover:bg-ink/[.06]"
      title="Sign in with Google"
      onClick={promptGoogleSignIn}
    >
      <svg width="13" height="13" viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
      </svg>
    </button>
  );

  return (
    <aside data-component="TreePane" className="flex flex-col h-full min-w-0 overflow-hidden border-r border-ink/10" style={style}>
      <header className="flex-none px-[18px] pt-4 pb-3.5 border-b border-ink/10">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[22px] font-semibold tracking-[-.01em] flex-1 truncate">Sutamaya</div>
          {user && (
            <button
              className="relative flex flex-none items-center rounded-full p-[2px]"
              style={{ background: 'rgba(27,25,23,.09)' }}
              title={paneView === 'library' ? 'Switch to My Lists (x)' : 'Switch to Library (x)'}
              onClick={() => setPaneView((v) => (v === 'library' ? 'lists' : 'library'))}
            >
              <div
                className="absolute top-[2px] bottom-[2px] rounded-full bg-white shadow-[0_1px_2px_rgba(27,25,23,.18)] transition-[left] duration-200 ease-out"
                style={{ left: paneView === 'library' ? 2 : '50%', width: 'calc(50% - 2px)' }}
              />
              <span className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full transition-colors ${paneView === 'library' ? 'text-ink' : 'text-ink/45'}`}>
                <Library size={13} strokeWidth={2} />
              </span>
              <span className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full transition-colors ${paneView === 'lists' ? 'text-ink' : 'text-ink/45'}`}>
                <List size={13} strokeWidth={2} />
              </span>
            </button>
          )}
          {mobile && (
            <div className="flex items-center gap-3.5 flex-none">
              {signedInBadge}
              <button className="flex items-center text-ink/[.62]" title="Settings" onClick={() => navigate('/settings')}>
                <Settings size={16} strokeWidth={1.75} />
              </button>
            </div>
          )}
        </div>
        <div className="relative">
          <input
            id={SEARCH_INPUT_ID}
            ref={searchInput}
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search ID, title, blurb, note, text"
            className="w-full h-[38px] border border-ink/[.22] rounded-field pl-3 pr-8 bg-field text-[14.5px] outline-none"
          />
          {!searchFocused && !query && (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-sans text-[11px] text-ink/35 border border-ink/20 rounded px-[5px] leading-[16px]">
              /
            </kbd>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="sc flex-1 py-2.5 pb-6">
        {searching ? (
          <div>
            <div className="px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">
              {hits.length} {hits.length === 1 ? 'result' : 'results'}
            </div>
            {hits.map(({ id, sutta }, i) => (
              <button
                key={id}
                ref={(el) => {
                  hitRefs.current[i] = el;
                }}
                className={`row flex flex-col w-full text-left gap-[1px] px-[18px] py-[11px] border-b border-ink/[.07] ${i === activeIndex ? 'bg-ink/[.06]' : ''}`}
                onClick={() => onOpenSutta(id)}
              >
                <span>
                  <span className="font-sans text-[11.5px] font-bold text-ink/60 mr-2.5">{sutta.ref}</span>
                  <span className="text-[16px] font-semibold leading-[1.3]">{sutta.en}</span>
                </span>
                <span className="font-serif text-[13.5px] italic text-accent">{sutta.pali}</span>
              </button>
            ))}
            {hits.length === 0 && (
              <div className="font-sans text-center text-[13px] text-ink/40 py-[30px] px-5">No matches.</div>
            )}
          </div>
        ) : effectiveView === 'library' ? (
          <div>
            {corpus.nikayas.map((n) => {
                const open = !!expanded[n.id];
                const expandableNode = isExpandable(n);
                return (
                  <div key={n.id}>
                    <button
                      data-node-id={n.id}
                      className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] ${nodeId === n.id ? 'bg-ink/[.06]' : ''}`}
                      onClick={() => (expandableNode ? toggleExpanded(n.id) : onSelect(n.id))}
                    >
                      <span className="w-[11px] flex-none flex items-center justify-center text-ink/40">
                        {expandableNode ? open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} /> : ''}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[16px] font-semibold leading-[1.3]">{n.label}</span>
                        <span className="block font-sans text-[12.5px] font-medium text-ink/60 mt-[1px]">{n.sub}</span>
                      </span>
                      <span className="font-sans text-[11.5px] font-medium text-ink/50">{n.count}</span>
                    </button>
                    {expandableNode &&
                      open &&
                      n.chapters!.map((c) => (
                        <TreeRow key={c.id} node={c} depth={1} nodeId={nodeId} expanded={expanded} onToggle={toggleExpanded} onSelect={onSelect} />
                      ))}
                  </div>
                );
              })}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between pl-[18px] pr-[10px] pt-2 pb-1">
              <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">My lists</span>
              <div className="flex items-center gap-[7px]">
                <button
                  title={reorderMode ? 'Done reordering' : 'Reorder & nest lists'}
                  className="w-[22px] h-[22px] border rounded-md flex items-center justify-center"
                  style={{
                    borderColor: reorderMode ? '#8A6A3B' : 'rgba(27,25,23,.28)',
                    background: reorderMode ? '#8A6A3B' : 'transparent',
                    color: reorderMode ? '#FBFAF7' : 'rgba(27,25,23,.5)',
                  }}
                  onClick={() => {
                    setReorderMode((m) => !m);
                    setMenuOpenId(null);
                  }}
                >
                  <ArrowUpDown size={12} strokeWidth={2} />
                </button>
                <button
                  className="plus w-[22px] h-[22px] border border-ink/[.28] rounded-md flex items-center justify-center text-[15px] leading-none text-ink/50"
                  onClick={() => {
                    setCreatingParentId((c) => (c === undefined ? null : undefined));
                    setDraft('');
                    setTimeout(() => listInput.current?.focus(), 30);
                  }}
                >
                  +
                </button>
              </div>
            </div>
            {reorderMode && (
              <div className="px-[18px] pb-1.5 font-sans text-[11.5px] text-ink/45">Drag a list onto another to nest it, or to the top/bottom edge of a row to reorder.</div>
            )}
            {creatingParentId === null && (
              <div className="px-[18px] pt-1.5 pb-2">
                <input
                  ref={listInput}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onDraftKey}
                  onBlur={() => setCreatingParentId(undefined)}
                  placeholder="List name — return to create"
                  className="w-full h-[34px] border border-accent rounded-lg px-2.5 bg-field text-[14.5px] outline-none"
                />
              </div>
            )}
            {topLevelLists.map((l, idx) => (
              <ListRow
                key={l.id}
                list={l}
                depth={0}
                nodeId={nodeId}
                childrenOf={listChildrenOf}
                totalMembers={listTotalMembers}
                listExpanded={listExpanded}
                onToggle={toggleListExpanded}
                onSelect={onSelect}
                menuOpenId={menuOpenId}
                onToggleMenu={toggleListMenu}
                editingId={editingId}
                editDraft={editDraft}
                onEditDraftChange={setEditDraft}
                onStartEdit={startEditList}
                onCommitEdit={commitEditList}
                onCancelEdit={cancelEditList}
                onDelete={deleteList}
                onArmDelete={armDeleteList}
                confirmDeleteId={confirmDeleteId}
                onCancelDelete={cancelDeleteList}
                onMove={moveList}
                onAddChild={addChildList}
                creatingParentId={creatingParentId}
                draft={draft}
                onDraftChange={setDraft}
                onDraftKey={onDraftKey}
                draftInputRef={(el) => {
                  listInput.current = el;
                }}
                siblingIndex={idx}
                siblingCount={topLevelLists.length}
                reorderMode={reorderMode}
                dragId={dragId}
                overId={overId}
                overZone={overZone}
                onRowPointerDown={onRowPointerDown}
                registerRowEl={registerRowEl}
              />
            ))}
            {autoLists.length > 0 && (
              <div>
                <div className="px-[18px] pt-[22px] pb-1">
                  <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">Automatic</span>
                </div>
                {autoLists.map(({ list, sub, Icon }) => (
                  <button
                    key={list.id}
                    data-node-id={list.id}
                    className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] ${
                      nodeId === String(list.id) ? 'bg-ink/[.06]' : ''
                    }`}
                    onClick={() => onSelect(String(list.id))}
                  >
                    <span className="w-[11px] flex-none flex items-center justify-center text-ink/40">
                      <Icon size={13} strokeWidth={2} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-semibold leading-[1.3]">{list.label}</span>
                      <span className="block font-sans text-[12.5px] font-medium text-ink/60 mt-[1px]">{sub}</span>
                    </span>
                    <span className="font-sans text-[11.5px] font-medium text-ink/50">{list.items.length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {desktop && (
        <footer className="font-sans flex-none flex justify-between px-[18px] py-[13px] border-t border-ink/10 text-[13px] text-ink/50">
          <button className="flex items-center" title="Settings" onClick={() => navigate('/settings')}>
            <Settings size={16} strokeWidth={1.75} />
          </button>
          {signedInBadge}
        </footer>
      )}

    </aside>
  );
}
