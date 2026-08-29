import { useCallback, useMemo } from 'react';
import type { ListDef } from '../lib/types';

// Derivations over the user's list tree, shared by TreePane's render, useListCrud's moveList and
// the drag cluster's siblingIdsWithInsert. All depend only on `lists`, so one hook computes them
// once for all three.
export function useListTreeIndex(lists: ListDef[]) {
  const listChildrenOf = useMemo(() => {
    const byParent = new Map<string | null, ListDef[]>();
    for (const l of lists) {
      const key = l.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(l);
    }
    return (parentId: string) => byParent.get(parentId) || [];
  }, [lists]);

  // Total distinct sutta count for a list — the library's own `node.count`, but computed at render
  // time rather than baked into corpus.json, since a user list's `items` change at any moment.
  // Recurses through `listChildrenOf` and unions each level's `items` into a Set: the same sutta
  // can belong to a parent list and one of its sub-lists, so a plain sum would double-count.
  const listMemberSets = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l] as const));
    const cache = new Map<string, Set<string>>();
    function collect(id: string): Set<string> {
      const cached = cache.get(id);
      if (cached) return cached;
      const set = new Set<string>(byId.get(id)?.items || []);
      cache.set(id, set);
      for (const child of listChildrenOf(id)) {
        for (const memberId of collect(child.id)) set.add(memberId);
      }
      return set;
    }
    for (const l of lists) collect(l.id);
    return cache;
  }, [lists, listChildrenOf]);

  // A group holds no items, so its badge counts how many lists and groups sit anywhere underneath
  // it, recursing through `listChildrenOf` the way listMemberSets does.
  const listGroupCounts = useMemo(() => {
    const cache = new Map<string, number>();
    function collect(id: string): number {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      let count = 0;
      for (const child of listChildrenOf(id)) {
        count += 1 + collect(child.id);
      }
      cache.set(id, count);
      return count;
    }
    for (const l of lists) collect(l.id);
    return cache;
  }, [lists, listChildrenOf]);
  // useCallback'd, since it passes straight through to ListRow, whose memoization needs it
  // referentially stable across renders that don't change the underlying counts.
  const countFor = useCallback(
    (l: ListDef) => (l.kind === 'group' ? (listGroupCounts.get(l.id) ?? 0) : (listMemberSets.get(l.id)?.size ?? 0)),
    [listGroupCounts, listMemberSets]
  );

  // What a delete takes with it: every list nested underneath the row, and every distinct sutta at
  // or below it. Both are the same recursive indexes the row's count badge reads, so the number in
  // the confirmation and the number on the badge can't disagree. The delete has no undo, and the
  // badge alone doesn't say what a group is hiding, so the prompt names it.
  const deleteScopeFor = useCallback(
    (l: ListDef) => ({ lists: listGroupCounts.get(l.id) ?? 0, suttas: listMemberSets.get(l.id)?.size ?? 0 }),
    [listGroupCounts, listMemberSets]
  );

  const topLevelLists = useMemo(() => lists.filter((l) => !l.parentId && !l.auto), [lists]);

  return { listChildrenOf, listMemberSets, listGroupCounts, countFor, deleteScopeFor, topLevelLists };
}
