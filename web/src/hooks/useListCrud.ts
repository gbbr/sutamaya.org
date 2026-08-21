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
  // `undefined` = no draft input open; `null` = creating a top-level entry; a list id = creating
  // a sub-list under that list.
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  // Only meaningful (and only shown) for a top-level draft — a per-row "+" only ever appears on
  // a group row and always adds a plain list inside it (see ListRow), no choice to make there.
  const [draftKind, setDraftKind] = useState<ListKind>('list');
  // Set only for the network round-trip inside submitDraft, to the same value `creatingParentId`
  // held right before it was reset — `creatingParentId` itself resets to undefined immediately on
  // submit for a snappy feel, but createList() itself awaits the API call, so without this the
  // draft input's row would collapse to zero height for that gap before the new list lands
  // (TreePane/ListsTreeView and ListRow both reserve that row's height while this is set, keyed to
  // which parent — top-level vs. a specific group row — actually submitted).
  const [submittingParentId, setSubmittingParentId] = useState<string | null | undefined>(undefined);
  const listInput = useRef<HTMLInputElement | null>(null);

  // Every handler below is useCallback'd (mirroring TreePane's own toggleExpanded — see its
  // comment) so ListRow's memoization isn't defeated by a freshly-allocated handler on every
  // TreePane render (this hook is called fresh each time). Most only ever call setState
  // functions (themselves stable), so they carry no deps; the few that read other state directly
  // (commitEditList, submitDraft, ...) depend on it, but that state only changes while the
  // relevant row is actively being edited/created — not during an ordinary toggle/expand/select —
  // so the identity churn stays scoped to that one row.
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

  // The header's own "+" — toggles a top-level draft open/closed, defaulting the kind picker
  // back to 'list' each time it opens fresh (not whatever was last picked).
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
    // The header's own "+" (parentId null, top level) lets the user pick list vs. group via
    // `draftKind`; every per-row "+" only ever appears on a group row (see ListRow) and always
    // adds a plain list inside it, no choice to make there.
    const kind = parentId === null ? draftKind : 'list';
    setCreatingParentId(undefined);
    setDraft('');
    if (!name) return;
    setSubmittingParentId(parentId);
    try {
      const list = await createList(name, parentId, kind);
      onCreated?.(list);
    } catch (e) {
      // createList writes to the local mirror and can't fail on the network, so this only catches
      // something genuinely unexpected — enough to keep the draft input from staying stuck open.
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
