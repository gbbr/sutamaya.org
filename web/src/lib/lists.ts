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

// membership[suttaId] carries list ids — this resolves one back to its list and breadcrumb, falling
// back to a bare id-only result when no matching list exists (it was deleted since).
export function resolveListById(id: string, flatTree: ListPathOption[]): ListPathOption | { list: null; depth: 0; breadcrumb: string } {
  return flatTree.find((f) => f.list.id === id) ?? { list: null, depth: 0, breadcrumb: id };
}

export interface SuttaRowChip {
  id: string;
  // The list's own name — the leaf, which is what the user named it.
  label: string;
  // The immediate parent group's name, absent for a top-level list. Rendered as the chip's leading
  // segment (SuttaRowChips), which is what tells apart two lists sharing a name under different
  // parents. Only one level up: a nested path turns a row of chips into a wall of text.
  parent?: string;
  // The full "Group / List" path, carried as the hover title so a desktop pointer can resolve a
  // chip nested more than one level deep.
  breadcrumb: string;
}

export interface SuttaRowMeta {
  chips: SuttaRowChip[];
  hlCount: number;
  // The distinct colours behind that count, drawn as swatches beside it — see highlightColors.
  hlColors: string[];
}

// Per-sutta list-membership chips and total highlight count for a row's meta line, shared by
// ListPane's rows and TreePane's mobile search results. The auto lists are filtered out of the
// chips, since the highlight badge and the note text already show that. Chips follow the user's My
// Lists tree order (flatLists' depth-first order) rather than membership[id]'s insertion order, so
// a row's chips stay stable as membership changes. `excludeId` drops one more list from every row:
// ListPane passes the list it is showing, since "in this list" is what the reader already knows.
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

// Corpus.ts's ancestorsOf, for TreePane's "My lists" tree: every ancestor list id along `nodeId`'s
// `parentId` chain that has to be open for it to be visible, plus `nodeId` itself, so a list
// deep-linked directly shows its own children rather than sitting highlighted and shut.
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
