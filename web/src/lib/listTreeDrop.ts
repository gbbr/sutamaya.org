import type { DropZone } from './types';

// One row of the "My lists" tree as seen by the drag hit-test, already filtered down to valid
// drop candidates (excludes the dragged row itself and any of its own descendants — see
// useListTreeDrag's updateDropTarget, the only caller) and sorted by `top` ascending.
export interface DropRow {
  id: string;
  top: number;
  bottom: number;
  isGroup: boolean;
}

// Resolves what dropping at vertical position `y` would do, given the currently-rendered rows of
// the list tree. Pulled out of useListTreeDrag as a pure function so it's directly testable with
// plain geometry (no real DOM/jsdom layout needed) — see listTreeDrop.test.ts.
//
// Two passes, in order:
// 1) Nesting: the pointer sitting over the inner half of a *group* row nests as its child.
//    Checked (and, if it matches, resolved) first — scoped to a band inside the row's own
//    top/bottom edges, not those edges themselves, so it never competes with a neighboring row's
//    own edge for the same pixel.
// 2) Sibling position: resolved from each row's vertical midpoint, the same technique ListPane's
//    own sutta reorder uses (see its updateDragTarget) — the first row whose midpoint sits below
//    the pointer wins as "insert before it"; past every row's midpoint means "insert after the
//    last one". This always resolves to *some* target for any y within the tree's rendered
//    bounds, unlike independent top/bottom-quarter zones computed per row in isolation, which
//    left a dead zone over the middle half of any plain (non-group) row — landing there was
//    simply an invalid 'inside' zone with no fallback, so letting go reset the drag to its start
//    position instead of dropping anywhere.
//
// Together these two passes are also what eliminates the double drop-indicator line that used to
// show up right under an expanded group's own name: with independent per-row zone math, the
// group's own bottom edge ("sibling after the group, i.e. outside it") and its first child's top
// edge ("first inside the group") sat on the same boundary pixel and could both look valid there.
// Here there's exactly one linear scan producing exactly one answer for any given y — a group
// row can only ever match 'inside' (pass 1) or 'before' (pass 2, only when the pointer is above
// its own midpoint, e.g. because it has an even earlier sibling above it); it can never come out
// as 'after', since pass 2 only assigns 'after' as the fallback for landing past *every* row's
// midpoint, and an expanded group with a rendered child is by construction never the last row in
// `rows` — so there is nothing left for its first child's own 'before' edge to conflict with.
export function resolveTreeDropTarget(y: number, rows: DropRow[]): { id: string; zone: DropZone } | null {
  for (const row of rows) {
    if (y < row.top || y > row.bottom) continue;
    if (row.isGroup) {
      const ratio = (y - row.top) / (row.bottom - row.top);
      if (ratio > 0.25 && ratio < 0.75) return { id: row.id, zone: 'inside' };
    }
    // This is the row the pointer is vertically over, whether or not it just matched a nesting
    // band above — no need to keep scanning the rest for one.
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

// Where to actually paint the drop-target line, given the resolved target above and the same
// `rows` it was resolved from. Every row already has its own permanent bottom separator (see
// ListRow's static `border-b`), always drawn regardless of dragging — so a 'before' target is
// re-expressed here as the *previous* row's bottom edge instead of drawing a brand-new line on
// the target's own top edge: both sit on the exact same physical boundary, so recoloring the
// separator that's already there means one boundary gets one line, not the plain grey separator
// sitting immediately next to a brand-new accent one. Only the very first row in the whole tree
// falls back to its own top edge, since there's no row above it to recolor instead.
export function resolveDropIndicator(target: { id: string; zone: DropZone } | null, rows: DropRow[]): DropIndicator | null {
  if (!target) return null;
  if (target.zone === 'inside') return { id: target.id, edge: 'inside' };
  if (target.zone === 'after') return { id: target.id, edge: 'bottom' };
  const idx = rows.findIndex((r) => r.id === target.id);
  if (idx > 0) return { id: rows[idx - 1].id, edge: 'bottom' };
  return { id: target.id, edge: 'top' };
}
