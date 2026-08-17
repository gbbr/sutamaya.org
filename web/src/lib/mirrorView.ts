import { repairListTree } from './listTree';
import { HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID, RECENT_AUTO_LIST_ID, RECENT_AUTO_LIST_CAP } from './autoLists';
import type { UserData } from './api';
import type { MirrorState } from './mirror';
import type { Highlight, HighlightsMap, ListDef, Membership, NotesMap, VisitedMap } from './types';

// Derives what the UI renders from the mirror — the client-side half of the worker's
// assembleUserData (worker/src/lib/userData.js), ported rather than reimplemented so both produce
// the same lists, membership and auto-lists from the same rows.
//
// It has to exist here because the mirror, not the server, is now the source of truth: a sutta
// highlighted offline must appear under "Highlights" immediately, and a note written offline under
// "Notes", neither of which can wait on a round trip. The server keeps its copy, which still
// serves the pull.

// Bounds how many rows ListPane has to render for an auto-list — it renders every item as a full
// DOM row, unvirtualized. Mirrors AUTO_LIST_CAP in worker/src/lib/userData.js.
const AUTO_LIST_CAP = 100;

// Dedupes `entries` by id keeping each one's most recent `at`, sorts descending, caps to `limit`.
// The worker's lib/autoListRecency.js, ported.
function latestIds(entries: { id: string; at: string }[], limit: number): string[] {
  const mostRecent = new Map<string, string>();
  entries.forEach(({ id, at }) => {
    const prev = mostRecent.get(id);
    if (prev === undefined || at > prev) mostRecent.set(id, at);
  });
  return [...mostRecent.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, limit)
    .map(([id]) => id);
}

// One highlight group's stored rows, as the reader renders them. Row ids are synthetic — a group's
// own `g` plus the segment index, which is exactly what makes them stable across a pull, since the
// server's row ids are minted per insert and mean nothing to the client beyond being React keys.
function rowsOf(group: { g: string; ranges: { i: number; s: number; e: number }[]; color: string | null; mtime: string }): Highlight[] {
  if (!group.color) return [];
  return group.ranges.map((r) => ({ id: `${group.g}:${r.i}`, i: r.i, s: r.s, e: r.e, c: group.color!, g: group.g, m: group.mtime }));
}

// Every stored highlight row for one sutta — what displacedGroupIds needs in order to work out
// which groups a fresh selection displaces (see lib/mirror.ts's writeHighlightRecord).
export function highlightRowsFor(state: MirrorState, suttaId: string): Highlight[] {
  return Object.values(state.highlights)
    .filter((record) => record.data.suttaId === suttaId)
    .flatMap((record) => rowsOf(record.data));
}

export function deriveUserData(state: MirrorState): UserData {
  const membership: Membership = {};
  // repairListTree decides which lists survive at all — dropping tombstones and everything beneath
  // them — as well as their order and, where a stored parentId dangles, the parentId each is
  // shaped with. `position`/`mtime`/`deleted` feed that repair and stop here.
  const lists: ListDef[] = repairListTree(Object.values(state.lists).map((record) => record.data)).map((row) => {
    row.items.forEach((suttaId) => {
      (membership[suttaId] = membership[suttaId] || []).push(row.id);
    });
    return { id: row.id, label: row.label, parentId: row.parentId, kind: row.kind, items: row.items };
  });

  const notes: NotesMap = {};
  const noteEntries: { id: string; at: string }[] = [];
  for (const { data } of Object.values(state.notes)) {
    // A cleared note is kept as a record so it can lose a merge against a stale device pushing the
    // old body back — but "has a note" means non-empty text, here as on the server.
    if (!data.text) continue;
    notes[data.suttaId] = data.text;
    noteEntries.push({ id: data.suttaId, at: data.mtime });
  }

  const highlights: HighlightsMap = {};
  const highlightEntries: { id: string; at: string }[] = [];
  for (const { data } of Object.values(state.highlights)) {
    const rows = rowsOf(data);
    if (!rows.length) continue;
    (highlights[data.suttaId] = highlights[data.suttaId] || []).push(...rows);
    highlightEntries.push({ id: data.suttaId, at: data.mtime });
  }

  const visited: VisitedMap = {};
  const visitedEntries: { id: string; at: string }[] = [];
  for (const { data } of Object.values(state.visited)) {
    visited[data.suttaId] = data.visitedAt;
    visitedEntries.push({ id: data.suttaId, at: data.visitedAt });
  }

  // Most-recent first, since an auto-list has no stored order the way a real list has, and capped
  // because ListPane renders every item as an unvirtualized DOM row.
  const recentIds = latestIds(visitedEntries, RECENT_AUTO_LIST_CAP);
  const highlightedIds = latestIds(highlightEntries, AUTO_LIST_CAP);
  const notedIds = latestIds(noteEntries, AUTO_LIST_CAP);

  if (recentIds.length) {
    lists.push({ id: RECENT_AUTO_LIST_ID, label: 'Recent', parentId: null, kind: 'list', items: recentIds, auto: true });
    recentIds.forEach((id) => (membership[id] = [...(membership[id] || []), RECENT_AUTO_LIST_ID]));
  }
  if (highlightedIds.length) {
    lists.push({ id: HIGHLIGHTS_AUTO_LIST_ID, label: 'Highlights', parentId: null, kind: 'list', items: highlightedIds, auto: true });
    highlightedIds.forEach((id) => (membership[id] = [...(membership[id] || []), HIGHLIGHTS_AUTO_LIST_ID]));
  }
  if (notedIds.length) {
    lists.push({ id: NOTES_AUTO_LIST_ID, label: 'Notes', parentId: null, kind: 'list', items: notedIds, auto: true });
    notedIds.forEach((id) => (membership[id] = [...(membership[id] || []), NOTES_AUTO_LIST_ID]));
  }

  return { lists, membership, notes, highlights, visited };
}
