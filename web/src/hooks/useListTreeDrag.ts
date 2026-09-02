import { useCallback, useRef, useState, type RefObject } from 'react';
import { usePointerDragSession } from './usePointerDragSession';
import {
  resolveTreeDropTarget,
  resolveDropIndicator,
  isDescendantOf,
  planListDrop,
  type DropRow,
  type DropIndicator,
} from '../lib/listTreeDrop';
import type { DropZone, ListDef } from '../lib/types';

interface UseListTreeDragParams {
  lists: ListDef[];
  listChildrenOf: (parentId: string) => ListDef[];
  topLevelLists: ListDef[];
  scrollRef: RefObject<HTMLElement | null>;
  setListExpanded: (updater: (x: Record<string, boolean>) => Record<string, boolean>) => void;
  reorderLists: (parentId: string | null, order: string[]) => Promise<void>;
}

// Dragging a list or group to a new place in the tree, over Pointer Events (usePointerDragSession)
// rather than HTML5 drag-and-drop, which touch browsers don't fire reliably.
//
// Each frame, the pointer's Y is hit-tested against every visible row's live rect: the inner half
// of a group's row nests the dragged list inside it, the blank space below the tree means the top
// level, and anywhere else is a sibling position. The dragged row's own descendants are excluded,
// so a group can't be dropped into itself. Every zone commits as one reorderLists call, which
// re-parents as well as positions, so a drop across parents is a single write.
export function useListTreeDrag({ lists, listChildrenOf, topLevelLists, scrollRef, setListExpanded, reorderLists }: UseListTreeDragParams) {
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // The row or edge ListRow draws the drop highlight on, normalized from the raw target below.
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  // Every visible row's element, and the live drop target. Refs, since the drag's window-level
  // listener registers once and would otherwise read drag-start values for the whole drag.
  const rowElRefs = useRef<Map<string, HTMLElement>>(new Map());
  // One cached ref-callback per row id, so ListRow's `ref` never sees a new function identity and
  // React doesn't reattach every row's DOM ref on each render. A callback for a deleted id is
  // simply never invoked again.
  const rowRefCallbacks = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  const dragIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);
  const overZoneRef = useRef<DropZone | null>(null);

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

  // Resolves which row the pointer is over and what dropping there would do, from each visible
  // row's current rect (resolveTreeDropTarget, lib/listTreeDrop.ts). Rows are sorted by screen
  // position, since a prior drag can reorder them without remounting any.
  const updateDropTarget = useCallback(
    (y: number) => {
      const draggedId = dragIdRef.current;
      if (!draggedId) return;

      // The dragged row and its own descendants, which dropping into would make a cycle.
      const invalid = new Set<string>([draggedId]);
      for (const l of lists) {
        if (isDescendantOf(lists, l.id, draggedId)) invalid.add(l.id);
      }

      const rows: DropRow[] = [];
      for (const [id, el] of rowElRefs.current.entries()) {
        if (invalid.has(id)) continue;
        const rect = el.getBoundingClientRect();
        const list = lists.find((l) => l.id === id);
        rows.push({ id, top: rect.top, bottom: rect.bottom, isGroup: list?.kind === 'group', parentId: list?.parentId ?? null });
      }
      rows.sort((a, b) => a.top - b.top);

      const target = resolveTreeDropTarget(y, rows);
      overIdRef.current = target?.id ?? null;
      overZoneRef.current = target?.zone ?? null;
      setIndicator(resolveDropIndicator(target, rows));
    },
    [lists]
  );

  // Applies a drop, through the plan planListDrop (lib/listTreeDrop.ts) works out for its zone.
  const commitDrop = useCallback(
    async (draggedId: string, target: ListDef, zone: DropZone) => {
      const plan = planListDrop(lists, draggedId, target, zone, listChildrenOf, topLevelLists);
      if (plan.type === 'invalid') return;
      await reorderLists(plan.parentId, plan.order);
      // Opens a group dropped into, so the row is visible where it landed.
      if (zone === 'inside') setListExpanded((x) => ({ ...x, [target.id]: true }));
    },
    [lists, listChildrenOf, topLevelLists, setListExpanded, reorderLists]
  );

  const finishTreeDrag = useCallback(() => {
    const draggedId = dragIdRef.current;
    const targetId = overIdRef.current;
    const zone = overZoneRef.current;
    dragIdRef.current = null;
    overIdRef.current = null;
    overZoneRef.current = null;
    setDragId(null);
    setIndicator(null);
    if (!draggedId || !targetId || draggedId === targetId || !zone) return;
    const target = lists.find((l) => l.id === targetId);
    if (!target) return;
    void commitDrop(draggedId, target, zone);
  }, [lists, commitDrop]);

  const dragSession = usePointerDragSession({ scrollRef, onFrame: updateDropTarget });

  // Starts a drag from a row, engaging only once the pointer clears a small threshold, so a plain
  // tap still reaches the row's own buttons.
  const onRowPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      dragSession.start(e, {
        threshold: 6,
        onEngage: () => {
          dragIdRef.current = id;
          setDragId(id);
        },
        onEnd: finishTreeDrag,
      });
    },
    [dragSession, finishTreeDrag]
  );

  return { reorderMode, setReorderMode, dragId, indicator, onRowPointerDown, getRowRef };
}
