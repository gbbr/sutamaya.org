import { AUTO_LIST_IDS } from './autoLists';
import { highlightColors, highlightCount } from './highlights';
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

// membership[suttaId] carries list ids (see worker/src/routes/data.js's buildUserData) — this
// resolves one back to its list and breadcrumb. Falls back to a bare id-only result if no
// matching list is found (e.g. it was deleted since).
export function resolveListById(id: string, flatTree: ListPathOption[]): ListPathOption | { list: null; depth: 0; breadcrumb: string } {
  return flatTree.find((f) => f.list.id === id) ?? { list: null, depth: 0, breadcrumb: id };
}

export interface SuttaRowChip {
  id: string;
  // The list's own name — the leaf is what the user named and what identifies the list to them.
  label: string;
  // The *immediate* parent group's name, absent for a top-level list. Rendered as the chip's own
  // leading segment (see SuttaRowChips), which is what distinguishes two lists sharing a name
  // under different parents — "#anicca" alone doesn't say which group it belongs to, and a
  // hover title can't say it on a touch screen. Only one level up: the full path is what the
  // tree is for, and a nested path turns a row of chips into a wall of text.
  parent?: string;
  // The full "Group / List" path, carried as the hover title so a desktop pointer can still
  // resolve a chip nested more than one level deep.
  breadcrumb: string;
}

export interface SuttaRowMeta {
  chips: SuttaRowChip[];
  hlCount: number;
  // The distinct colours behind that count, drawn as swatches beside it — see highlightColors.
  hlColors: string[];
}

// Per-sutta list-membership chips + total highlight count for a row's meta line — shared by
// ListPane's own rows and TreePane's mobile search results (see SuttaRowMeta component). The
// "Highlights"/"Notes" auto lists are filtered out of the chips since those are already shown via
// the highlight badge and note text directly, same reasoning as ListPane's own comment on this.
// Chips are ordered to match the user's My Lists tree (flatLists' own depth-first order), not
// membership[id]'s raw array order (which is just insertion order — the order suttas happened to
// get added to each list), so a row's chips stay stable/predictable as list membership changes.
// `excludeId` drops one more list from every row: the list being viewed. ListPane passes the list
// it is showing, since "in this list" is exactly what the reader already knows. Nothing else
// passes it — the reader's chips are a full account of a sutta's memberships, and a search result
// isn't inside any one list.
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
    map.set(id, { chips, hlCount: highlightCount(hl), hlColors: highlightColors(hl) });
  }
  return map;
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
