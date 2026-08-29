import type { DropZone, ListDef } from './types';

// One row of the "My lists" tree as the drag hit-test sees it: already filtered to valid drop
// candidates — the dragged row and its descendants excluded by useListTreeDrag's updateDropTarget,
// the only caller — and sorted by `top` ascending.
export interface DropRow {
  id: string;
  top: number;
  bottom: number;
  isGroup: boolean;
  // Where this row currently sits, so the indicator can name the group a sibling drop lands in.
  parentId: string | null;
}

// Resolves what dropping at vertical position `y` would do, given the currently-rendered rows of
// the list tree. Pure, so it is testable with plain geometry and no DOM layout.
//
// Two passes, in order:
// 1) Nesting: the pointer over the inner half of a group row nests as its child, at the end of that
//    group. Scoped to a band inside the row's top/bottom edges, not the edges themselves, so it
//    never competes with a neighbouring row's edge for the same pixel.
// 2) Sibling position: the first row whose vertical midpoint sits below the pointer wins as "insert
//    before it". Past every midpoint means the end of the top level, whatever the last row's own
//    nesting — the same answer the pointer would get anywhere else it sits below a row belonging to
//    a shallower level, so the bottom of the pane isn't a special case. Landing inside a group is
//    the group's own row, which is one gesture rather than a boundary to hit.
//
// One linear scan gives exactly one answer for any y, so there is no dead zone and no boundary
// where two zones both look valid.
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
  // Past every midpoint. The row is carried along only so the indicator can be drawn at the bottom
  // of the tree, where the pointer actually is; planListDrop ignores it (see 'end' there).
  if (!target && rows.length > 0) target = { id: rows[rows.length - 1].id, zone: 'end' };
  return target;
}

export interface DropIndicator {
  id: string;
  edge: 'top' | 'bottom' | 'inside';
  // The group row to tint, when the line alone wouldn't say which level the drop lands at: a line
  // under the last row of a group and a line under the whole tree sit on the same boundary but mean
  // different parents. Tinted the way an 'inside' drop already tints its group, which is honest —
  // "after that group's last child" and "inside that group" are the same destination.
  insideId?: string;
}

// Where to paint the drop-target line, given the resolved target and the same `rows` it came from.
// Every row already carries a permanent bottom separator (ListRow's `border-b`), so a 'before'
// target is re-expressed as the previous row's bottom edge: both sit on the same boundary, and
// recolouring the separator already there gives one boundary one line rather than a grey separator
// beside a new accent one.
//
// That only holds while the two rows actually touch. The row being dragged is still rendered but is
// not a candidate here, so the row above a target may be separated from it by that ghost (or by an
// open options menu) — and the recoloured separator would then appear above the gap, nowhere near
// the pointer, reading as no line at all. A target whose predecessor isn't adjacent draws its own
// top edge instead, as the very first row in the tree always does.
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
// 'before' sibling zone is valid for either kind — both may rest at the top level.
export function isValidListDrop(lists: ListDef[], draggedId: string, targetId: string, zone: DropZone): boolean {
  const dragged = lists.find((l) => l.id === draggedId);
  if (!dragged) return false;
  // 'end' is the top level, where every row may rest, and its target row is only where the pointer
  // happened to stop — so the descendant guard below, which is about landing near your own subtree,
  // has nothing to say about it.
  if (zone === 'end') return true;
  const target = lists.find((l) => l.id === targetId);
  if (!target || isDescendantOf(lists, target.id, draggedId)) return false;
  if (zone === 'inside') return target.kind === 'group';
  return true;
}

// The sibling id order that results from inserting `insertId` before `targetId` within
// `parentId`'s children (or the top level, if `parentId` is null).
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

// What committing a drop does — always one reorder, whichever zone it came from. reorderLists
// (queueSiblingOrder in lib/mirror.ts) sets parentId on every id in `order` as well as its
// position, so a drop that crosses into a different parent needs nothing else. Nesting goes the
// same way rather than through a bare parent change: position is a separate field that a parent
// change leaves untouched, so a nested row used to keep whatever position it held in the group it
// came from and land somewhere arbitrary among its new siblings.
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
  // Dropped below every row: the end of the top level, whatever row the pointer last passed over.
  if (zone === 'end') {
    return { type: 'reorder', parentId: null, order: [...topLevelLists.map((l) => l.id).filter((id) => id !== draggedId), draggedId] };
  }
  // Nested into a group. A group's row carries no position indicator — dropping on it says "in
  // here", not "in here, third" — so the row goes to the end, where the eye looks for the thing
  // just added.
  if (zone === 'inside') {
    return { type: 'reorder', parentId: target.id, order: [...childrenOf(target.id).map((l) => l.id).filter((id) => id !== draggedId), draggedId] };
  }
  const newParentId = target.parentId ?? null;
  const order = siblingIdsWithInsert(childrenOf, topLevelLists, newParentId, draggedId, target.id);
  return { type: 'reorder', parentId: newParentId, order };
}
