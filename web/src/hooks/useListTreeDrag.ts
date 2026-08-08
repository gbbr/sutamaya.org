import { useCallback, useRef, useState, type RefObject } from 'react';
import { usePointerDragSession } from './usePointerDragSession';
import type { DropZone, ListDef } from '../lib/types';

interface UseListTreeDragParams {
  lists: ListDef[];
  listChildrenOf: (parentId: string) => ListDef[];
  topLevelLists: ListDef[];
  scrollRef: RefObject<HTMLElement | null>;
  setListExpanded: (updater: (x: Record<string, boolean>) => Record<string, boolean>) => void;
  setListParent: (id: string, parentId: string | null) => Promise<void>;
  reorderLists: (parentId: string | null, order: string[]) => Promise<void>;
}

// Pointer Events drive the list-tree drag (mirrors ListPane's sutta-reorder drag, so touch works
// the same way here too — HTML5 drag-and-drop doesn't fire reliably on touch browsers; the shared
// window-listener/rAF/auto-scroll plumbing lives in usePointerDragSession). A list can nest other
// lists as children (folder-like) as well as reorder among siblings — dropping on the top/bottom
// quarter of a row reorders as a sibling, the middle half nests it as a child (see
// updateDropTarget's zone math below).
export function useListTreeDrag({ lists, listChildrenOf, topLevelLists, scrollRef, setListExpanded, setListParent, reorderLists }: UseListTreeDragParams) {
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overZone, setOverZone] = useState<DropZone | null>(null);
  // These all need to be refs, not just state: the drag session's window-level pointermove
  // listener registers once, at drag-start — unlike a JSX-bound handler (re-bound fresh every
  // render), that one listener keeps calling the *same* closure for the rest of the drag, so
  // anything it reads via a plain state variable would see whatever that variable's value was
  // back at drag-start, not later updates. `overIdRef`/`overZoneRef` mirror the `overId`/`overZone`
  // state (kept only for rendering the drop-target highlight) so finishTreeDrag reads the live
  // values instead of a stale snapshot.
  const rowElRefs = useRef<Map<string, HTMLElement>>(new Map());
  // One stable ref-callback per row id, cached here — so ListRow's `ref={...}` never sees a new
  // function identity across renders it's otherwise unaffected by. An inline `(el) =>
  // registerRowEl(id, el)` at the JSX call site would be a fresh closure every render, making
  // React detach+reattach the DOM ref for every visible row on every TreePane re-render (not
  // just during drag). Never evicted on list deletion — a stale cached closure for a deleted id
  // is simply never invoked again, which costs nothing worth the complexity of pruning it.
  const rowRefCallbacks = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  const dragIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);
  const overZoneRef = useRef<DropZone | null>(null);

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

  // A list can't hold anything (no sub-lists, no sub-groups), so it's only ever a valid drop
  // target for the 'inside' zone when it's a group — true for both a dragged list and a dragged
  // group. The 'before'/'after' sibling zones just reorder-and-inherit the target's own parent,
  // which is always valid regardless of kind: both a list and a group are allowed to rest at the
  // top level (a list can get there by being dragged next to another top-level row, same as a
  // group can — the "+" next to My Lists just doesn't happen to create one there directly).
  function isValidDrop(draggedId: string, targetId: string, zone: DropZone): boolean {
    const dragged = lists.find((l) => l.id === draggedId);
    const target = lists.find((l) => l.id === targetId);
    if (!dragged || !target || isDescendant(target.id, draggedId)) return false;
    if (zone === 'inside') return target.kind === 'group';
    return true;
  }

  function siblingIdsWithInsert(parentId: string | null, insertId: string, targetId: string, after: boolean): string[] {
    const scoped = (parentId ? listChildrenOf(parentId) : topLevelLists).map((s) => s.id).filter((id) => id !== insertId);
    const targetIdx = scoped.indexOf(targetId);
    scoped.splice(after ? targetIdx + 1 : targetIdx, 0, insertId);
    return scoped;
  }

  const getRowRef = useCallback((id: string) => {
    let cb = rowRefCallbacks.current.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) rowElRefs.current.set(id, el);
        else rowElRefs.current.delete(id);
      };
      rowRefCallbacks.current.set(id, cb);
    }
    return cb;
  }, []);

  // Which row (if any) the pointer currently sits vertically over, and which third of it —
  // top/bottom quarter reorders as a sibling, the middle half nests as a child. Hit-tests by
  // rect instead of relying on native dragover targeting, since the drag session's window-level
  // pointermove listener doesn't know which row DOM-wise the pointer is above.
  function updateDropTarget(y: number) {
    const draggedId = dragIdRef.current;
    if (!draggedId) return;
    const candidates: { id: string; zone: DropZone }[] = [];
    rowElRefs.current.forEach((el, rowId) => {
      if (rowId === draggedId) return;
      const rect = el.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) return;
      const ratio = (y - rect.top) / rect.height;
      const zone: DropZone = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
      if (isValidDrop(draggedId, rowId, zone)) candidates.push({ id: rowId, zone });
    });
    const next = candidates[0] ?? null;
    overIdRef.current = next?.id ?? null;
    overZoneRef.current = next?.zone ?? null;
    setOverId(next?.id ?? null);
    setOverZone(next?.zone ?? null);
  }

  async function commitDrop(draggedId: string, target: ListDef, zone: DropZone) {
    const dragged = lists.find((l) => l.id === draggedId);
    if (!dragged || !isValidDrop(draggedId, target.id, zone)) return;
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
    setDragId(null);
    setOverId(null);
    setOverZone(null);
    if (!draggedId || !targetId || draggedId === targetId || !zone) return;
    const target = lists.find((l) => l.id === targetId);
    if (!target) return;
    void commitDrop(draggedId, target, zone);
  }

  const dragSession = usePointerDragSession({ scrollRef, onFrame: updateDropTarget });

  // Only engages a drag once the pointer clears a small movement threshold — a plain tap (no
  // movement) reaches the row's own button clicks (select/rename/delete/menu) normally, since
  // nothing here calls preventDefault or pointer-capture until a real drag is underway.
  function onRowPointerDown(e: React.PointerEvent, id: string) {
    dragSession.start(e, {
      threshold: 6,
      onEngage: () => {
        dragIdRef.current = id;
        setDragId(id);
      },
      onEnd: finishTreeDrag,
    });
  }

  return { reorderMode, setReorderMode, dragId, overId, overZone, onRowPointerDown, getRowRef };
}
