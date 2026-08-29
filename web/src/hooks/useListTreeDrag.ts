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

// Pointer Events drive the list-tree drag, mirroring ListPane's sutta-reorder drag, since HTML5
// drag-and-drop doesn't fire reliably on touch browsers; the shared window-listener, rAF and
// auto-scroll plumbing lives in usePointerDragSession. A list can nest other lists as well as
// reorder among siblings: dropping on the inner half of a group's row nests it as a child, the
// blank space below the tree means the top level, and anywhere else resolves to a sibling position
// (updateDropTarget below runs the hit-test).
export function useListTreeDrag({ lists, listChildrenOf, topLevelLists, scrollRef, setListExpanded, reorderLists }: UseListTreeDragParams) {
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // The row/edge ListRow actually renders a highlight on — see resolveDropIndicator for why this
  // is normalized away from the raw {overId, overZone} target (kept only in the refs below, for
  // committing the drop) rather than rendered directly.
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  // Refs rather than state: the drag session's window-level pointermove listener registers once, at
  // drag-start, and keeps calling that same closure for the rest of the drag, so anything read
  // through a plain state variable would see its drag-start value. finishTreeDrag reads these live
  // at drop time.
  const rowElRefs = useRef<Map<string, HTMLElement>>(new Map());
  // One stable ref-callback per row id, cached here, so ListRow's `ref={...}` never sees a new
  // function identity across unrelated renders. An inline `(el) => registerRowEl(id, el)` would be
  // a fresh closure every render, making React detach and reattach the DOM ref for every visible
  // row on every TreePane re-render. Never evicted on list deletion: a stale closure for a deleted
  // id is simply never invoked again.
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

  // Which row the pointer sits vertically over, and what dropping there would do. Hit-tested by
  // rect rather than by native dragover targeting, since the window-level pointermove listener
  // doesn't know which row it is above. The zone math lives in resolveTreeDropTarget
  // (lib/listTreeDrop.ts); this gathers each visible row's current rect into that shape.
  //
  // Rows are sorted by actual screen position rather than by `rowElRefs`' Map insertion order: that
  // order is fixed at each row's first mount, but a prior drag can reorder the `lists` array — and
  // so the rows' visual order — without remounting any of them, leaving the Map's order stale.
  const updateDropTarget = useCallback(
    (y: number) => {
      const draggedId = dragIdRef.current;
      if (!draggedId) return;

      // A row nested under the dragged item (only relevant while dragging a group) can't itself
      // be a valid target — dropping the group inside/around its own descendant would create a
      // cycle.
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

  // planListDrop (lib/listTreeDrop.ts) decides what a drop does; every zone resolves to one
  // reorderLists call, which re-parents every id in the order it is given as well as positioning
  // them — so even a drop crossing into another parent is a single write with no two-step flicker.
  const commitDrop = useCallback(
    async (draggedId: string, target: ListDef, zone: DropZone) => {
      const plan = planListDrop(lists, draggedId, target, zone, listChildrenOf, topLevelLists);
      if (plan.type === 'invalid') return;
      await reorderLists(plan.parentId, plan.order);
      // Dropped into a group: open it, so the row can be seen where it landed.
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

  // Engages a drag only once the pointer clears a small movement threshold, so a plain tap still
  // reaches the row's own button clicks: nothing here calls preventDefault or pointer-capture until
  // a real drag is underway. useCallback'd, since it passes straight through to ListRow, whose
  // memoization needs it referentially stable across unrelated renders.
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
