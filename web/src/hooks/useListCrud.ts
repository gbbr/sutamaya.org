import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import type { ListDef, ListKind } from '../lib/types';

// How long the "can't delete, not empty" message stays up before auto-dismissing — long enough
// to read ("'X' has 3 suttas — remove them first."), no manual dismiss button.
const BLOCKED_DELETE_MS = 4000;

// What's stopping a delete: a group with lists/groups still nested inside it, or a list with
// suttas still in it. Deleting either today would silently discard content (a group's children
// get bounced up to its own parent server-side, see routes/lists.js — not what "delete" should
// mean here; a list's `items` are just gone) rather than actually confirming the user wants that.
export interface BlockedDelete {
  id: string;
  count: number;
  kind: 'items' | 'children';
}

interface UseListCrudParams {
  listChildrenOf: (parentId: string) => ListDef[];
  topLevelLists: ListDef[];
  setListExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  createList: (label: string, parentId?: string | null, kind?: ListKind) => Promise<ListDef>;
  renameList: (id: string, label: string) => Promise<void>;
  removeList: (id: string) => Promise<void>;
  reorderLists: (parentId: string | null, order: string[]) => Promise<void>;
  // Called after a new list/group is actually created (submitDraft) — routing to it stays the
  // caller's job (TreePane navigates there) rather than this hook importing `navigate` directly.
  onCreated?: (list: ListDef) => void;
}

// List CRUD state (menu/edit/delete/draft) and the handlers that operate on it — everything
// TreePane's "My lists" tree needs beyond the pure derivations in useListTreeIndex.
export function useListCrud({ listChildrenOf, topLevelLists, setListExpanded, createList, renameList, removeList, reorderLists, onCreated }: UseListCrudParams) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [blockedDelete, setBlockedDelete] = useState<BlockedDelete | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // `undefined` = no draft input open; `null` = creating a top-level entry; a list id = creating
  // a sub-list under that list.
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  // Only meaningful (and only shown) for a top-level draft — a per-row "+" only ever appears on
  // a group row and always adds a plain list inside it (see ListRow), no choice to make there.
  const [draftKind, setDraftKind] = useState<ListKind>('list');
  const listInput = useRef<HTMLInputElement | null>(null);
  const blockedDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blockedDeleteTimer.current) clearTimeout(blockedDeleteTimer.current);
    };
  }, []);

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

  function armBlockedDelete(blocked: BlockedDelete) {
    if (blockedDeleteTimer.current) clearTimeout(blockedDeleteTimer.current);
    setBlockedDelete(blocked);
    blockedDeleteTimer.current = setTimeout(() => setBlockedDelete(null), BLOCKED_DELETE_MS);
  }

  function armDeleteList(l: ListDef) {
    setMenuOpenId(null);
    // A group can't hold suttas itself (see ListRow's comment on that), so it's blocked purely on
    // having any nested lists/groups; a list is blocked purely on its own `items`.
    if (l.kind === 'group') {
      const childCount = listChildrenOf(l.id).length;
      if (childCount > 0) {
        armBlockedDelete({ id: l.id, count: childCount, kind: 'children' });
        return;
      }
    } else if (l.items.length > 0) {
      armBlockedDelete({ id: l.id, count: l.items.length, kind: 'items' });
      return;
    }
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
  }

  // The header's own "+" — toggles a top-level draft open/closed, defaulting the kind picker
  // back to 'list' each time it opens fresh (not whatever was last picked).
  function toggleTopLevelDraft() {
    setCreatingParentId((c) => (c === undefined ? null : undefined));
    setDraft('');
    setDraftKind('list');
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

  async function submitDraft() {
    const name = draft.trim();
    const parentId = creatingParentId ?? null;
    // The header's own "+" (parentId null, top level) lets the user pick list vs. group via
    // `draftKind`; every per-row "+" only ever appears on a group row (see ListRow) and always
    // adds a plain list inside it, no choice to make there.
    const kind = parentId === null ? draftKind : 'list';
    setCreatingParentId(undefined);
    setDraft('');
    if (!name) return;
    try {
      const list = await createList(name, parentId, kind);
      onCreated?.(list);
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

  return {
    menuOpenId,
    setMenuOpenId,
    confirmDeleteId,
    blockedDelete,
    editingId,
    editDraft,
    setEditDraft,
    creatingParentId,
    setCreatingParentId,
    draft,
    setDraft,
    draftKind,
    setDraftKind,
    listInput,
    toggleListMenu,
    startEditList,
    commitEditList,
    cancelEditList,
    armDeleteList,
    cancelDeleteList,
    deleteList,
    addChildList,
    toggleTopLevelDraft,
    moveList,
    submitDraft,
    onDraftKey,
  };
}
