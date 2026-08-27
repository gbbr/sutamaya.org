import type { DropZone, ListDef } from './types';

// One row of the "My lists" tree as the drag hit-test sees it: already filtered to valid drop
// candidates — the dragged row and its descendants excluded by useListTreeDrag's updateDropTarget,
// the only caller — and sorted by `top` ascending.
export interface DropRow {
  id: string;
  top: number;
  bottom: number;
  isGroup: boolean;
}

// Resolves what dropping at vertical position `y` would do, given the currently-rendered rows of
// the list tree. Pure, so it is testable with plain geometry and no DOM layout.
//
// Two passes, in order:
// 1) Nesting: the pointer over the inner half of a group row nests as its child. Scoped to a band
//    inside the row's top/bottom edges, not the edges themselves, so it never competes with a
//    neighbouring row's edge for the same pixel.
// 2) Sibling position: the first row whose vertical midpoint sits below the pointer wins as "insert
//    before it"; past every midpoint means "insert after the last row". Same technique as
//    ListPane's sutta reorder.
//
// One linear scan gives exactly one answer for any y within the tree's rendered bounds, so there is
// no dead zone and no boundary where two zones both look valid. A group row can only come out as
// 'inside' or 'before' — 'after' is the fallback for landing past every midpoint, and an expanded
// group with a rendered child is never the last row in `rows`.
export function resolveTreeDropTarget(y: number, rows: DropRow[]): { id: string; zone: DropZone } | null {
  for (const row of rows) {
    if (y < row.top || y > row.bottom) continue;
    if (row.isGroup) {
      const ratio = (y - row.top) / (row.bottom - row.top);
      if (ratio > 0.25 && ratio < 0.75) return { id: row.id, zone: 'inside' };
    }
    // The pointer is over this row, so no other row can match a nesting band.
    break;
  }

  let target: { id: string; zone: DropZone } | null = null;
  for (const row of rows) {
    if (y < row.top + (row.bottom - row.top) / 2) {
      target = { id: row.id, zone: 'before' };
      break;
    }
  }
  if (!target && rows.length > 0) target = { id: rows[rows.length - 1].id, zone: 'after' };
  return target;
}

export interface DropIndicator {
  id: string;
  edge: 'top' | 'bottom' | 'inside';
}

// Where to paint the drop-target line, given the resolved target and the same `rows` it came from.
// Every row already carries a permanent bottom separator (ListRow's `border-b`), so a 'before'
// target is re-expressed as the previous row's bottom edge: both sit on the same boundary, and
// recolouring the separator already there gives one boundary one line rather than a grey separator
// beside a new accent one. Only the first row in the tree falls back to its own top edge.
export function resolveDropIndicator(target: { id: string; zone: DropZone } | null, rows: DropRow[]): DropIndicator | null {
  if (!target) return null;
  if (target.zone === 'inside') return { id: target.id, edge: 'inside' };
  if (target.zone === 'after') return { id: target.id, edge: 'bottom' };
  const idx = rows.findIndex((r) => r.id === target.id);
  if (idx > 0) return { id: rows[idx - 1].id, edge: 'bottom' };
  return { id: target.id, edge: 'top' };
}

// True if `candidateId` sits somewhere underneath `ofId` in the list tree — dropping `ofId` into a
// descendant of itself would create a cycle.
export function isDescendantOf(lists: ListDef[], candidateId: string, ofId: string): boolean {
  let cur = lists.find((l) => l.id === candidateId);
  while (cur?.parentId) {
    if (cur.parentId === ofId) return true;
    cur = lists.find((l) => l.id === cur!.parentId);
  }
  return false;
}

// A list holds no sub-lists, so the 'inside' zone is only valid when the target is a group. The
// 'before'/'after' sibling zones are valid for either kind — both may rest at the top level.
export function isValidListDrop(lists: ListDef[], draggedId: string, targetId: string, zone: DropZone): boolean {
  const dragged = lists.find((l) => l.id === draggedId);
  const target = lists.find((l) => l.id === targetId);
  if (!dragged || !target || isDescendantOf(lists, target.id, draggedId)) return false;
  if (zone === 'inside') return target.kind === 'group';
  return true;
}

// The sibling id order that results from inserting `insertId` next to `targetId` within
// `parentId`'s children (or the top level, if `parentId` is null).
export function siblingIdsWithInsert(
  childrenOf: (parentId: string) => ListDef[],
  topLevelLists: ListDef[],
  parentId: string | null,
  insertId: string,
  targetId: string,
  after: boolean
): string[] {
  const scoped = (parentId ? childrenOf(parentId) : topLevelLists).map((s) => s.id).filter((id) => id !== insertId);
  const targetIdx = scoped.indexOf(targetId);
  scoped.splice(after ? targetIdx + 1 : targetIdx, 0, insertId);
  return scoped;
}

export type ListDropPlan =
  | { type: 'invalid' }
  | { type: 'reparent'; parentId: string; alreadyParented: boolean }
  | { type: 'reorder'; parentId: string | null; order: string[] };

// What committing a drop does. reorderLists (queueSiblingOrder in lib/mirror.ts) sets parentId on
// every id in `order`, so a 'before'/'after' drop needs only the 'reorder' plan even when it
// crosses into a different parent. 'reparent' is for 'inside', which nests into a group with no
// sibling order to insert into.
export function planListDrop(
  lists: ListDef[],
  draggedId: string,
  target: ListDef,
  zone: DropZone,
  childrenOf: (parentId: string) => ListDef[],
  topLevelLists: ListDef[]
): ListDropPlan {
  const dragged = lists.find((l) => l.id === draggedId);
  if (!dragged || !isValidListDrop(lists, draggedId, target.id, zone)) return { type: 'invalid' };
  if (zone === 'inside') {
    return { type: 'reparent', parentId: target.id, alreadyParented: dragged.parentId === target.id };
  }
  const newParentId = target.parentId ?? null;
  const order = siblingIdsWithInsert(childrenOf, topLevelLists, newParentId, draggedId, target.id, zone === 'after');
  return { type: 'reorder', parentId: newParentId, order };
}
