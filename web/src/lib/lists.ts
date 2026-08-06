import type { ListDef } from './types';

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
