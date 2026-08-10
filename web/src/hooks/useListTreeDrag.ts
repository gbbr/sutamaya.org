import { useCallback, useRef, useState, type RefObject } from 'react';
import { usePointerDragSession } from './usePointerDragSession';
import { resolveTreeDropTarget, resolveDropIndicator, type DropRow, type DropIndicator } from '../lib/listTreeDrop';
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
// lists as children (folder-like) as well as reorder among siblings — dropping on the inner half
// of a group's row nests it as a child, anywhere else resolves to a sibling position (see
// updateDropTarget below for the two-pass hit-test that decides which).
export function useListTreeDrag({ lists, listChildrenOf, topLevelLists, scrollRef, setListExpanded, setListParent, reorderLists }: UseListTreeDragParams) {
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // The row/edge ListRow actually renders a highlight on — see resolveDropIndicator for why this
  // is normalized away from the raw {overId, overZone} target (kept only in the refs below, for
  // committing the drop) rather than rendered directly.
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  // These need to be refs, not just state: the drag session's window-level pointermove listener
  // registers once, at drag-start — unlike a JSX-bound handler (re-bound fresh every render),
  // that one listener keeps calling the *same* closure for the rest of the drag, so anything it
  // reads via a plain state variable would see whatever that variable's value was back at
  // drag-start, not later updates. finishTreeDrag reads these live values at drop time.
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
  // useCallback'd (as are the handlers below it) so the chain ending in onRowPointerDown — passed
  // straight through to ListRow (see TreePane) — stays referentially stable across renders that
  // don't actually change `lists`, matching TreeRow/ListRow's own memoization needs.
  const isDescendant = useCallback(
    (candidateId: string, ofId: string): boolean => {
      let cur = lists.find((l) => l.id === candidateId);
      while (cur?.parentId) {
        if (cur.parentId === ofId) return true;
        cur = lists.find((l) => l.id === cur!.parentId);
      }
      return false;
    },
    [lists]
  );

  // A list can't hold anything (no sub-lists, no sub-groups), so it's only ever a valid drop
  // target for the 'inside' zone when it's a group — true for both a dragged list and a dragged
  // group. The 'before'/'after' sibling zones just reorder-and-inherit the target's own parent,
  // which is always valid regardless of kind: both a list and a group are allowed to rest at the
  // top level (a list can get there by being dragged next to another top-level row, same as a
  // group can — the "+" next to My Lists just doesn't happen to create one there directly).
  const isValidDrop = useCallback(
    (draggedId: string, targetId: string, zone: DropZone): boolean => {
      const dragged = lists.find((l) => l.id === draggedId);
      const target = lists.find((l) => l.id === targetId);
      if (!dragged || !target || isDescendant(target.id, draggedId)) return false;
      if (zone === 'inside') return target.kind === 'group';
      return true;
    },
    [lists, isDescendant]
  );

  const siblingIdsWithInsert = useCallback(
    (parentId: string | null, insertId: string, targetId: string, after: boolean): string[] => {
      const scoped = (parentId ? listChildrenOf(parentId) : topLevelLists).map((s) => s.id).filter((id) => id !== insertId);
      const targetIdx = scoped.indexOf(targetId);
      scoped.splice(after ? targetIdx + 1 : targetIdx, 0, insertId);
      return scoped;
    },
    [listChildrenOf, topLevelLists]
  );

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

  // Which row (if any) the pointer currently sits vertically over, and what dropping there would
  // do. Hit-tests by rect instead of relying on native dragover targeting, since the drag
  // session's window-level pointermove listener doesn't know which row DOM-wise the pointer is
  // above. The actual zone math lives in resolveTreeDropTarget (lib/listTreeDrop.ts, pulled out
  // to be plain-geometry testable) — this just gathers each visible row's current rect into that
  // shape.
  //
  // Rows are sorted by their *actual* current screen position rather than trusted in
  // `rowElRefs`' Map insertion order: that order is fixed at each row's first mount, but a prior
  // drag can reorder the underlying `lists` array (and therefore the rows' visual order) without
  // remounting any of them (same `key`s), leaving the Map's iteration order stale relative to
  // what's actually on screen — sorting by `rect.top` keeps this correct regardless.
  const updateDropTarget = useCallback(
    (y: number) => {
      const draggedId = dragIdRef.current;
      if (!draggedId) return;

      // A row nested under the dragged item (only relevant while dragging a group) can't itself
      // be a valid target — dropping the group inside/around its own descendant would create a
      // cycle.
      const invalid = new Set<string>([draggedId]);
      for (const l of lists) {
        if (isDescendant(l.id, draggedId)) invalid.add(l.id);
      }

      const rows: DropRow[] = Array.from(rowElRefs.current.entries())
        .filter(([id]) => !invalid.has(id))
        .map(([id, el]) => {
          const rect = el.getBoundingClientRect();
          return { id, top: rect.top, bottom: rect.bottom, isGroup: lists.find((l) => l.id === id)?.kind === 'group' };
        })
        .sort((a, b) => a.top - b.top);

      const target = resolveTreeDropTarget(y, rows);
      overIdRef.current = target?.id ?? null;
      overZoneRef.current = target?.zone ?? null;
      setIndicator(resolveDropIndicator(target, rows));
    },
    [lists, isDescendant]
  );

  const commitDrop = useCallback(
    async (draggedId: string, target: ListDef, zone: DropZone) => {
      const dragged = lists.find((l) => l.id === draggedId);
      if (!dragged || !isValidDrop(draggedId, target.id, zone)) return;
      if (zone === 'inside') {
        if (dragged.parentId !== target.id) await setListParent(draggedId, target.id);
        setListExpanded((x) => ({ ...x, [target.id]: true }));
        return;
      }
      const newParentId = target.parentId ?? null;
      // No separate setListParent call here even when this drop also crosses into a different
      // parent — reorderLists' own endpoint sets parentId on every id in `order` unconditionally
      // (see its own comment), so one call already re-parents *and* positions the dragged item.
      // Two sequential calls here used to mean two optimistic re-renders — the dragged item would
      // land under its new parent first, then jump again once reorderLists' own network response
      // came back — a visible two-step flicker on drop.
      const order = siblingIdsWithInsert(newParentId, draggedId, target.id, zone === 'after');
      await reorderLists(newParentId, order);
    },
    [lists, isValidDrop, setListParent, setListExpanded, siblingIdsWithInsert, reorderLists]
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

  // Only engages a drag once the pointer clears a small movement threshold — a plain tap (no
  // movement) reaches the row's own button clicks (select/rename/delete/menu) normally, since
  // nothing here calls preventDefault or pointer-capture until a real drag is underway.
  // useCallback'd — passed straight through to ListRow (see TreePane), whose own memoization
  // (mirroring TreeRow's) needs this to stay referentially stable across unrelated renders.
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
