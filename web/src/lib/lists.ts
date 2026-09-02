import { AUTO_LIST_IDS } from './autoLists';
import { highlightColors } from './highlights';
import type { HighlightsMap, ListDef, Membership } from './types';

export interface ListPathOption {
  list: ListDef;
  depth: number;
  breadcrumb: string;
}

// Depth-first flatten of the list tree, excluding the auto-managed lists, each entry carrying its
// full "Parent / Child" breadcrumb.
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

// Resolves a list id back to its list and breadcrumb, or to a bare id-only result where the list
// has since been deleted.
export function resolveListById(id: string, flatTree: ListPathOption[]): ListPathOption | { list: null; depth: 0; breadcrumb: string } {
  return flatTree.find((f) => f.list.id === id) ?? { list: null, depth: 0, breadcrumb: id };
}

export interface SuttaRowChip {
  id: string;
  // The list's own name — the leaf, which is what the user named it.
  label: string;
  // The immediate parent group's name, absent for a top-level list, drawn as the chip's leading
  // segment. One level only: a full path turns a row of chips into a wall of text.
  parent?: string;
  // The full "Group / List" path, carried as the hover title.
  breadcrumb: string;
}

export interface SuttaRowMeta {
  chips: SuttaRowChip[];
  hlCount: number;
  // The distinct colours behind that count, drawn as swatches beside it.
  hlColors: string[];
}

// The membership chips and highlight count for a row's meta line. Chips follow the reader's own
// list-tree order rather than membership's insertion order, so they stay stable as membership
// changes, and the auto-lists are dropped, the highlight badge and note text saying as much
// already. `excludeId` drops one more — ListPane passes the list it is showing.
export function suttaRowMeta(ids: Iterable<string>, membership: Membership, highlights: HighlightsMap, flatLists: ListPathOption[], excludeId?: string): Map<string, SuttaRowMeta> {
  const listOrder = new Map(flatLists.map((f, i) => [f.list.id, i]));
  const labelById = new Map(flatLists.map((f) => [f.list.id, f.list.label]));
  const map = new Map<string, SuttaRowMeta>();
  for (const id of ids) {
    const chips = (membership[id] || [])
      .filter((c) => !AUTO_LIST_IDS.has(c) && c !== excludeId)
      .map((c) => {
        const { list, breadcrumb } = resolveListById(c, flatLists);
        const parent = list?.parentId ? labelById.get(list.parentId) : undefined;
        return { id: c, label: list?.label ?? breadcrumb, parent, breadcrumb };
      })
      .sort((a, b) => (listOrder.get(a.id) ?? Infinity) - (listOrder.get(b.id) ?? Infinity));
    const hl = highlights[id] || [];
    map.set(id, { chips, hlCount: hl.length, hlColors: highlightColors(hl) });
  }
  return map;
}

// The list ids that must be open for `nodeId` to be visible in the "My lists" tree, `nodeId`
// included, so a list linked to directly shows its own children rather than sitting shut.
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
