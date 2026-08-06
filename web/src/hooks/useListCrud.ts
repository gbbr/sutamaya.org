import { useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import type { ListDef, ListKind } from '../lib/types';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // `undefined` = no draft input open; `null` = creating a top-level list; a list id = creating
  // a sub-list under that list.
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const listInput = useRef<HTMLInputElement | null>(null);

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

  async function submitDraft() {
    const name = draft.trim();
    const parentId = creatingParentId ?? null;
    // The header's own "+" (parentId null, top level) always makes a group — "My lists" is a
    // tree of groups holding lists, not a flat bag of lists — while every per-row "+" only ever
    // appears on a group row (see ListRow) and adds a plain list inside it.
    const kind = parentId === null ? 'group' : 'list';
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
    editingId,
    editDraft,
    setEditDraft,
    creatingParentId,
    setCreatingParentId,
    draft,
    setDraft,
    listInput,
    toggleListMenu,
    startEditList,
    commitEditList,
    cancelEditList,
    armDeleteList,
    cancelDeleteList,
    deleteList,
    addChildList,
    moveList,
    submitDraft,
    onDraftKey,
  };
}
