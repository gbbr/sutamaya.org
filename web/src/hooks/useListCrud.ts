import { useCallback, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import type { ListDef, ListKind } from '../lib/types';

interface UseListCrudParams {
  listChildrenOf: (parentId: string) => ListDef[];
  topLevelLists: ListDef[];
  setListExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  createList: (label: string, parentId?: string | null, kind?: ListKind) => Promise<ListDef>;
  renameList: (id: string, label: string) => Promise<void>;
  removeList: (id: string) => Promise<void>;
  reorderLists: (parentId: string | null, order: string[]) => Promise<void>;
  // Called once a new list or group exists; routing to it is the caller's job.
  onCreated?: (list: ListDef) => void;
}

// The row menu, rename, delete-confirm and new-list draft state behind TreePane's "My lists" tree,
// and the handlers that drive them. Every one is stable, so ListRow's memoization holds.
export function useListCrud({ listChildrenOf, topLevelLists, setListExpanded, createList, renameList, removeList, reorderLists, onCreated }: UseListCrudParams) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Where a draft input is open: `undefined` for none, `null` for top level, or the id of the
  // group it is inside.
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  // List or group, for a top-level draft. A per-row "+" always adds a plain list.
  const [draftKind, setDraftKind] = useState<ListKind>('list');
  // Which parent has a submitted draft still in flight. `creatingParentId` clears at once so the
  // input feels snappy, and this is what reserves the row's height until the list exists.
  const [submittingParentId, setSubmittingParentId] = useState<string | null | undefined>(undefined);
  const listInput = useRef<HTMLInputElement | null>(null);

  const toggleListMenu = useCallback((id: string) => {
    setMenuOpenId((m) => (m === id ? null : id));
  }, []);

  const startEditList = useCallback((l: ListDef) => {
    setMenuOpenId(null);
    setEditingId(l.id);
    setEditDraft(l.label);
  }, []);

  const commitEditList = useCallback(() => {
    const id = editingId;
    const text = editDraft.trim();
    setEditingId(null);
    if (!id) return;
    if (text) renameList(id, text);
  }, [editingId, editDraft, renameList]);

  const cancelEditList = useCallback(() => {
    setEditingId(null);
  }, []);

  const armDeleteList = useCallback((l: ListDef) => {
    setMenuOpenId(null);
    setConfirmDeleteId(l.id);
  }, []);

  const cancelDeleteList = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  const deleteList = useCallback(
    (l: ListDef) => {
      setConfirmDeleteId(null);
      removeList(l.id);
    },
    [removeList]
  );

  const addChildList = useCallback(
    (parentId: string) => {
      setMenuOpenId(null);
      setListExpanded((x) => ({ ...x, [parentId]: true }));
      setCreatingParentId(parentId);
      setDraft('');
    },
    [setListExpanded]
  );

  // Opens or closes the header's top-level draft, with the kind picker back at 'list'.
  const toggleTopLevelDraft = useCallback(() => {
    setCreatingParentId((c) => (c === undefined ? null : undefined));
    setDraft('');
    setDraftKind('list');
  }, []);

  const moveList = useCallback(
    (l: ListDef, dir: -1 | 1) => {
      const scoped = l.parentId ? listChildrenOf(l.parentId) : topLevelLists;
      const idx = scoped.findIndex((s) => s.id === l.id);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= scoped.length) return;
      const order = scoped.map((s) => s.id);
      [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
      reorderLists(l.parentId ?? null, order);
    },
    [listChildrenOf, topLevelLists, reorderLists]
  );

  const submitDraft = useCallback(async () => {
    const name = draft.trim();
    const parentId = creatingParentId ?? null;
    // Only a top-level draft offers the list/group choice; a per-row "+" always adds a list.
    const kind = parentId === null ? draftKind : 'list';
    setCreatingParentId(undefined);
    setDraft('');
    if (!name) return;
    setSubmittingParentId(parentId);
    try {
      const list = await createList(name, parentId, kind);
      onCreated?.(list);
    } catch (e) {
      // createList writes to the local mirror and can't fail on the network, so only something
      // unexpected lands here; the draft row still has to be released.
      console.error('list create failed', e);
    } finally {
      setSubmittingParentId(undefined);
    }
  }, [draft, creatingParentId, draftKind, createList, onCreated]);

  const onDraftKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitDraft();
      } else if (e.key === 'Escape') {
        setCreatingParentId(undefined);
        setDraft('');
      }
    },
    [submitDraft]
  );

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
    draftKind,
    setDraftKind,
    submittingParentId,
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
