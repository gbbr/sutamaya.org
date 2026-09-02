import type { DropZone, ListDef } from './types';

// The geometry and shape of the list-tree drop hit-test: where a drop lands, where its indicator
// is drawn, and what the drop then does. Pure, so it is testable without DOM layout.

// One row of the tree as the hit-test sees it, already filtered to valid candidates and sorted by
// `top` ascending.
export interface DropRow {
  id: string;
  top: number;
  bottom: number;
  isGroup: boolean;
  // Where this row currently sits, so the indicator can name the group a sibling drop lands in.
  parentId: string | null;
}

// Resolves what dropping at vertical position `y` would do, in two passes:
//   inside – the pointer within a group row's middle band, nesting at the end of that group; a
//            band rather than the whole row, so it never competes with a neighbour's edge
//   before – otherwise, the first row whose midpoint sits below the pointer
//   end    – past every midpoint, the end of the top level
// Exactly one answer for any y, so there is no dead zone and no ambiguous boundary.
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
  // Past every midpoint. The row is carried only so the indicator can be drawn at the bottom of
  // the tree; planListDrop ignores it.
  if (!target && rows.length > 0) target = { id: rows[rows.length - 1].id, zone: 'end' };
  return target;
}

export interface DropIndicator {
  id: string;
  edge: 'top' | 'bottom' | 'inside';
  // The group row to tint, where the line alone wouldn't say which level the drop lands at — a
  // line under a group's last row and one under the whole tree sit on the same boundary.
  insideId?: string;
}

// Where to paint the drop line. A 'before' target is drawn as the previous row's bottom edge,
// recolouring the separator already there so one boundary carries one line — unless the two rows
// aren't touching, the dragged row's ghost or an open menu sitting between them, in which case the
// target draws its own top edge.
export function resolveDropIndicator(target: { id: string; zone: DropZone } | null, rows: DropRow[]): DropIndicator | null {
  if (!target) return null;
  if (target.zone === 'inside') return { id: target.id, edge: 'inside' };
  const row = rows.find((r) => r.id === target.id);
  // 'end' is the top level, so nothing is tinted; the other two land wherever the target row lives.
  const insideId = target.zone === 'end' ? undefined : row?.parentId ?? undefined;
  // 'end' already names the last rendered row, so both draw the same line: the bottom of the tree.
  if (target.zone === 'end') return { id: target.id, edge: 'bottom', insideId };
  const idx = rows.findIndex((r) => r.id === target.id);
  const prev = idx > 0 ? rows[idx - 1] : undefined;
  const adjacent = prev && row && Math.abs(prev.bottom - row.top) < 1;
  if (adjacent) return { id: prev.id, edge: 'bottom', insideId };
  return { id: target.id, edge: 'top', insideId };
}

// True if `candidateId` sits anywhere underneath `ofId` in the list tree.
export function isDescendantOf(lists: ListDef[], candidateId: string, ofId: string): boolean {
  let cur = lists.find((l) => l.id === candidateId);
  while (cur?.parentId) {
    if (cur.parentId === ofId) return true;
    cur = lists.find((l) => l.id === cur!.parentId);
  }
  return false;
}

// True when a drop is allowed: 'inside' only into a group, since a list holds no sub-lists, and
// never into the dragged row's own subtree.
export function isValidListDrop(lists: ListDef[], draggedId: string, targetId: string, zone: DropZone): boolean {
  const dragged = lists.find((l) => l.id === draggedId);
  if (!dragged) return false;
  // 'end' is the top level, where every row may rest, and its target row is only where the pointer
  // stopped.
  if (zone === 'end') return true;
  const target = lists.find((l) => l.id === targetId);
  if (!target || isDescendantOf(lists, target.id, draggedId)) return false;
  if (zone === 'inside') return target.kind === 'group';
  return true;
}

// The sibling order that results from inserting `insertId` before `targetId` among `parentId`'s
// children, or the top level when `parentId` is null.
export function siblingIdsWithInsert(
  childrenOf: (parentId: string) => ListDef[],
  topLevelLists: ListDef[],
  parentId: string | null,
  insertId: string,
  targetId: string
): string[] {
  const scoped = (parentId ? childrenOf(parentId) : topLevelLists).map((s) => s.id).filter((id) => id !== insertId);
  scoped.splice(scoped.indexOf(targetId), 0, insertId);
  return scoped;
}

export type ListDropPlan = { type: 'invalid' } | { type: 'reorder'; parentId: string | null; order: string[] };

// What committing a drop does: always one reorder, whichever zone it came from. queueSiblingOrder
// sets parentId as well as position on every id in `order`, so nesting and a cross-parent move
// need nothing further — a bare parent change would leave the row at whatever position it held in
// the group it came from.
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
  // Below every row: the end of the top level, whatever row the pointer last passed.
  if (zone === 'end') {
    return { type: 'reorder', parentId: null, order: [...topLevelLists.map((l) => l.id).filter((id) => id !== draggedId), draggedId] };
  }
  // Into a group, at the end: dropping on a group's row says "in here", not "in here, third".
  if (zone === 'inside') {
    return { type: 'reorder', parentId: target.id, order: [...childrenOf(target.id).map((l) => l.id).filter((id) => id !== draggedId), draggedId] };
  }
  const newParentId = target.parentId ?? null;
  const order = siblingIdsWithInsert(childrenOf, topLevelLists, newParentId, draggedId, target.id);
  return { type: 'reorder', parentId: newParentId, order };
}
