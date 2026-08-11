import { AUTO_LIST_IDS } from './autoLists';
import { highlightCount } from './highlights';
import type { HighlightsMap, ListDef, Membership } from './types';

export interface ListPathOption {
  list: ListDef;
  depth: number;
  breadcrumb: string;
}

// Depth-first flatten of the list tree (excluding the two auto-managed lists — they aren't real
// user lists), each carrying its full "Parent / Child" breadcrumb.
export function flattenListTree(lists: ListDef[]): ListPathOption[] {
  const byParent = new Map<string | null, ListDef[]>();
  for (const l of lists) {
    if (l.auto) continue;
    const key = l.parentId ?? null;
    const siblings = byParent.get(key);
    if (siblings) siblings.push(l);
    else byParent.set(key, [l]);
  }
  const out: ListPathOption[] = [];
  function walk(parentId: string | null, prefix: string, depth: number) {
    for (const l of byParent.get(parentId) ?? []) {
      const breadcrumb = prefix ? `${prefix} / ${l.label}` : l.label;
      out.push({ list: l, depth, breadcrumb });
      walk(l.id, breadcrumb, depth + 1);
    }
  }
  walk(null, '', 0);
  return out;
}

// membership[suttaId] carries list ids (see server/src/routes/data.js's buildUserData) — this
// resolves one back to its list and breadcrumb. Falls back to a bare id-only result if no
// matching list is found (e.g. it was deleted since).
export function resolveListById(id: string, flatTree: ListPathOption[]): ListPathOption | { list: null; depth: 0; breadcrumb: string } {
  return flatTree.find((f) => f.list.id === id) ?? { list: null, depth: 0, breadcrumb: id };
}

export interface SuttaRowChip {
  id: string;
  breadcrumb: string;
}

export interface SuttaRowMeta {
  chips: SuttaRowChip[];
  hlCount: number;
}

// Per-sutta list-membership chips + total highlight count for a row's meta line — shared by
// ListPane's own rows and TreePane's mobile search results (see SuttaRowMeta component). The
// "Highlights"/"Notes" auto lists are filtered out of the chips since those are already shown via
// the highlight badge and note text directly, same reasoning as ListPane's own comment on this.
export function suttaRowMeta(ids: Iterable<string>, membership: Membership, highlights: HighlightsMap, flatLists: ListPathOption[]): Map<string, SuttaRowMeta> {
  const map = new Map<string, SuttaRowMeta>();
  for (const id of ids) {
    const chips = (membership[id] || [])
      .filter((c) => !AUTO_LIST_IDS.has(c))
      .map((c) => ({ id: c, breadcrumb: resolveListById(c, flatLists).breadcrumb }));
    map.set(id, { chips, hlCount: highlightCount(highlights[id] || []) });
  }
  return map;
}

// Pure reducer for UserDataContext's reorderLists optimistic local update — pulled out so the
// logic that mirrors the server's own PUT /order handler (setting `parentId` on every id in
// `order` unconditionally, not just position) is directly testable. That mirroring is what lets
// useListTreeDrag's commitDrop fold a cross-parent drop into this one call instead of a separate
// setListParent first (see planListDrop in lib/listTreeDrop.ts) — the fix for a real shipped bug
// (a55e1ecc) where two sequential calls produced a visible two-step "jump" on drop.
export function applyListReorder(lists: ListDef[], parentId: string | null, order: string[]): ListDef[] {
  const orderIndex = new Map(order.map((id, idx) => [id, idx]));
  const inOrder = new Set(order);
  const siblings = lists
    .filter((l) => inOrder.has(l.id))
    .map((l) => (l.parentId === parentId ? l : { ...l, parentId }))
    .sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
  const others = lists.filter((l) => !inOrder.has(l.id));
  return [...others, ...siblings];
}

// Same idea as corpus.ts's ancestorsOf, for TreePane's "My lists" tree: every ancestor list id
// (by `parentId` chain) that needs to be open for `nodeId` — a list itself, e.g. from a
// membership chip's /browse/{list_id} navigation — to be visible, plus `nodeId` itself so a list
// deep-linked (or selected) directly shows its own children rather than just being highlighted
// shut.
export function ancestorsOfList(lists: ListDef[], nodeId: string | undefined): Record<string, boolean> {
  if (!nodeId) return {};
  const init: Record<string, boolean> = {};
  let cur = lists.find((l) => l.id === nodeId);
  if (cur) init[cur.id] = true;
  while (cur?.parentId) {
    init[cur.parentId] = true;
    cur = lists.find((l) => l.id === cur!.parentId);
  }
  return init;
}
