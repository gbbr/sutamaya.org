import { useCallback, useMemo } from 'react';
import type { ListDef } from '../lib/types';

// Derivations over the user's list tree — children by parent, the row count badges, and what a
// delete would take — computed once for TreePane's render, useListCrud and the drag cluster.
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

  // Every list's distinct suttas, its own and its descendants' unioned — a sutta can belong to
  // both a list and one of its sub-lists, which a plain sum would double-count.
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

  // Every group's count of the lists and groups anywhere underneath it, a group holding no items
  // of its own.
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
  // Returns the number a row's count badge shows.
  const countFor = useCallback(
    (l: ListDef) => (l.kind === 'group' ? (listGroupCounts.get(l.id) ?? 0) : (listMemberSets.get(l.id)?.size ?? 0)),
    [listGroupCounts, listMemberSets]
  );

  // Returns what deleting a row would take with it — the lists nested underneath and the distinct
  // suttas at or below it — for the confirmation prompt, off the same indexes the badge reads.
  const deleteScopeFor = useCallback(
    (l: ListDef) => ({ lists: listGroupCounts.get(l.id) ?? 0, suttas: listMemberSets.get(l.id)?.size ?? 0 }),
    [listGroupCounts, listMemberSets]
  );

  const topLevelLists = useMemo(() => lists.filter((l) => !l.parentId && !l.auto), [lists]);

  return { listChildrenOf, listMemberSets, listGroupCounts, countFor, deleteScopeFor, topLevelLists };
}
