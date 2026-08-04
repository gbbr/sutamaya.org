import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '@reach/router';
import {
  PanelLeftClose,
  Settings,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { SEARCH_INPUT_ID } from '../hooks/useListNav';
import { findNode, isExpandable, searchCorpus } from '../lib/corpus';
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

// One row of the "My lists" tree — a list can nest other lists as children (folder-like),
// with button-based rename/reorder/delete/nest controls instead of drag-and-drop, so every
// action works the same on touch as it does with a mouse.
function ListRow({
  list,
  depth,
  nodeId,
  childrenOf,
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
}: {
  list: ListDef;
  depth: number;
  nodeId?: string;
  childrenOf: (parentId: string) => ListDef[];
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
}) {
  const kids = childrenOf(list.id);
  const hasKids = kids.length > 0;
  const open = !!listExpanded[list.id];
  const editing = editingId === list.id;
  const menuOpen = menuOpenId === list.id;

  return (
    <div>
      <div
        className={`row flex items-center gap-[7px] w-full text-left pr-[10px] py-[7px] border-b border-ink/[.07] ${nodeId === String(list.id) ? 'bg-ink/[.06]' : ''}`}
        style={{ paddingLeft: 18 + depth * 14 }}
      >
        <button
          className="w-[11px] flex-none flex items-center justify-center text-ink/40"
          onClick={() => hasKids && onToggle(list.id)}
        >
          {hasKids ? open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} /> : null}
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
          <button className="flex-1 min-w-0 text-left text-[15px] font-semibold truncate py-[2px]" onClick={() => onSelect(String(list.id))}>
            {list.label}
          </button>
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

export function TreePane({ nodeId, onSelect, onOpenSutta, onSearch, query, activeIndex, visible = true }: TreePaneProps) {
  const { corpus } = useCorpus();
  const { lists, notes, createList, renameList, removeList, reorderLists } = useUserData();
  const { user, promptGoogleSignIn } = useAuth();
  const { mobile, desktop, paneW, hideTree } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>('tree', visible);
  // Computed synchronously on mount (not via an effect) so the tree is *already* expanded to
  // nodeId by the very first render — otherwise useScrollMemory's restore (a layout effect,
  // which always runs before any passive effect) would fire against a still-collapsed tree
  // whenever TreePane mounts fresh already pointed at a deep node (e.g. LibraryPage remounting
  // after the reader closes, on desktop where it's always "visible" so that restore-on-visible
  // fallback never kicks in either), silently clamping the restored scroll offset back to 0.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ancestorsOf(corpus, nodeId));
  const [libraryOpen, setLibraryOpen] = useState(true);

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

  function toggleExpanded(id: string) {
    setExpanded((x) => ({ ...x, [id]: !x[id] }));
  }
  // `undefined` = no draft input open; `null` = creating a top-level list; a list id = creating
  // a sub-list under that list.
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>({});
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const listInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const hitRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const listChildrenOf = useMemo(() => {
    const byParent = new Map<string | null, ListDef[]>();
    for (const l of lists) {
      const key = l.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(l);
    }
    return (parentId: string) => byParent.get(parentId) || [];
  }, [lists]);
  const topLevelLists = useMemo(() => lists.filter((l) => !l.parentId), [lists]);

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
    removeList(l.id, l.label);
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

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (corpus && searching ? searchCorpus(corpus, query, notes) : []), [corpus, query, searching, notes]);

  useEffect(() => {
    if (searching && activeIndex >= 0) hitRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, searching]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      searchInput.current?.focus();
      searchInput.current?.select();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    <aside className="flex flex-col h-full min-w-0 overflow-hidden border-r border-ink/10" style={style}>
      <header className="flex-none px-[18px] pt-4 pb-3.5 border-b border-ink/10">
        <div className="flex items-baseline gap-2.5 mb-3">
          <div className="text-[22px] font-semibold tracking-[-.01em] flex-1">Sutamaya</div>
          {desktop && (
            <button
              className="flex-none w-7 h-7 flex items-center justify-center rounded-md text-ink/55 hover:bg-ink/[.06]"
              title="Hide browse pane"
              onClick={() => hideTree()}
            >
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </button>
          )}
          {mobile && (
            <div className="flex items-center gap-3.5">
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
        ) : (
          <div>
            <button
              className="flex items-center gap-1 px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]"
              onClick={() => setLibraryOpen((o) => !o)}
            >
              Library {libraryOpen ? '−' : '+'}
            </button>
            {libraryOpen &&
              corpus.nikayas.map((n) => {
                const open = !!expanded[n.id];
                const expandableNode = isExpandable(n);
                return (
                  <div key={n.id}>
                    <button
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

            <div className="flex items-center justify-between px-[18px] pt-[22px] pb-1">
              <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">My lists</span>
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
              />
            ))}
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
