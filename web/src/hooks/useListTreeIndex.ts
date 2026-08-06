import { useMemo } from 'react';
import type { ListDef } from '../lib/types';

// Pure derivations over the user's list tree — shared by TreePane's render (My Lists tree),
// useListCrud's moveList, and the drag cluster's siblingIdsWithInsert. All depend only on
// `lists`, so one hook avoids duplicate recomputation across those three consumers.
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

  // Total distinct sutta count for a list, "just like the library entries" (ChapterRow's
  // `node.count`) but computed here at render time rather than baked into corpus.json, since a
  // user list's `items` (and its sub-lists') can change at any moment. Recurses through
  // `listChildrenOf` and unions each level's `items` into a Set — the same sutta can
  // independently belong to a parent list and one of its sub-lists (or two sibling sub-lists),
  // so a plain sum across levels would double-count; a dedup'd Set is the "how many distinct
  // suttas" the badge is meant to show.
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
  const listTotalMembers = (id: string) => listMemberSets.get(id)?.size ?? 0;

  // A group's own badge can't use listTotalMembers (a group holds no items) — it counts how many
  // lists/groups sit anywhere underneath it instead, recursing through `listChildrenOf` the same
  // way listMemberSets does.
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
  const groupTotalLists = (id: string) => listGroupCounts.get(id) ?? 0;
  const countFor = (l: ListDef) => (l.kind === 'group' ? groupTotalLists(l.id) : listTotalMembers(l.id));

  const topLevelLists = useMemo(() => lists.filter((l) => !l.parentId && !l.auto), [lists]);

  return { listChildrenOf, listMemberSets, listTotalMembers, listGroupCounts, groupTotalLists, countFor, topLevelLists };
}
