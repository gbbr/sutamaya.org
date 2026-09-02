import { repairListTree } from './listTree';
import {
  AUTO_LIST_CAP,
  HIGHLIGHTS_AUTO_LIST_ID,
  NOTES_AUTO_LIST_ID,
  RECENT_AUTO_LIST_ID,
  VISITED_AUTO_LIST_CAP,
} from './autoLists';
import type { UserData } from './api';
import type { HighlightRecord, MirrorState } from './mirror';
import type { Highlight, HighlightsMap, ListDef, Membership, NotesMap, VisitedMap } from './types';

// Derives what the UI renders from the mirror: the lists, membership and the three auto-lists. A
// port of the worker's assembleUserData, so both produce the same view from the same rows — it
// exists here because the mirror rather than the server is what the UI reads, so a sutta
// highlighted offline appears under "Highlights" at once.

// What the UI renders: the wire's `UserData`, with each note reduced to its text, the mtime having
// been used here to order the Notes auto-list.
export interface DerivedUserData extends Omit<UserData, 'notes'> {
  notes: NotesMap;
}

// Dedupes `entries` by id keeping each one's most recent `at`, newest first, capped to `limit`.
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

// One record as the reader renders it, or nothing at all — a pure erase paints nothing, and a
// record with no span is dropped rather than risking the render.
function highlightOf(record: HighlightRecord): Highlight[] {
  if (!record.color || !record.span) return [];
  const { i0, o0, i1, o1 } = record.span;
  return [{ id: record.g, i0, o0, i1, o1, c: record.color, m: record.mtime }];
}

// Document order, which the highlights panel lists in and the gutter's marks are drawn from, and
// which is stable under a re-pull where the mirror's own order is not.
function inDocumentOrder(highlights: Highlight[]): Highlight[] {
  return highlights.sort((a, b) => a.i0 - b.i0 || a.o0 - b.o0 || (a.id < b.id ? -1 : 1));
}

// One sutta's highlights, which displacedIds needs to work out what a fresh selection
// displaces (see lib/mirror.ts's writeHighlightRecord).
export function highlightsFor(state: MirrorState, suttaId: string): Highlight[] {
  return Object.values(state.highlights)
    .filter((record) => record.data.suttaId === suttaId)
    .flatMap((record) => highlightOf(record.data));
}

// The whole view the UI renders, derived from the mirror.
export function deriveUserData(state: MirrorState): DerivedUserData {
  const membership: Membership = {};
  // The surviving lists, in order, with any dangling parentId re-homed. `position`, `mtime` and
  // `deleted` feed that repair and stop here.
  const lists: ListDef[] = repairListTree(Object.values(state.lists).map((record) => record.data)).map((row) => {
    row.items.forEach((suttaId) => {
      (membership[suttaId] = membership[suttaId] || []).push(row.id);
    });
    return { id: row.id, label: row.label, parentId: row.parentId, kind: row.kind, items: row.items };
  });

  const notes: NotesMap = {};
  const noteEntries: { id: string; at: string }[] = [];
  for (const { data } of Object.values(state.notes)) {
    // "Has a note" means non-empty text, here as on the server; a cleared note is kept as a record
    // only so it can win a merge. The typeof guard drops a malformed record rather than crashing.
    if (typeof data.text !== 'string' || !data.text) continue;
    notes[data.suttaId] = data.text;
    noteEntries.push({ id: data.suttaId, at: data.mtime });
  }

  const highlights: HighlightsMap = {};
  const highlightEntries: { id: string; at: string }[] = [];
  for (const { data } of Object.values(state.highlights)) {
    const rows = highlightOf(data);
    if (!rows.length) continue;
    (highlights[data.suttaId] = highlights[data.suttaId] || []).push(...rows);
    highlightEntries.push({ id: data.suttaId, at: data.mtime });
  }
  for (const [suttaId, rows] of Object.entries(highlights)) highlights[suttaId] = inDocumentOrder(rows);

  const visited: VisitedMap = {};
  const visitedEntries: { id: string; at: string }[] = [];
  for (const { data } of Object.values(state.visited)) {
    visited[data.suttaId] = data.visitedAt;
    visitedEntries.push({ id: data.suttaId, at: data.visitedAt });
  }

  // The three auto-lists' items, most recent first — an auto-list has no stored order — and capped.
  const recentIds = latestIds(visitedEntries, VISITED_AUTO_LIST_CAP);
  const highlightedIds = latestIds(highlightEntries, AUTO_LIST_CAP);
  const notedIds = latestIds(noteEntries, AUTO_LIST_CAP);

  // How many suttas qualify before the cap, over distinct suttas as latestIds counts them — a
  // sutta with four highlights is one row, not four.
  const totalOf = (entries: { id: string; at: string }[]) => new Set(entries.map((e) => e.id)).size;

  if (recentIds.length) {
    lists.push({ id: RECENT_AUTO_LIST_ID, label: 'Visited', parentId: null, kind: 'list', items: recentIds, auto: true, total: totalOf(visitedEntries) });
    recentIds.forEach((id) => (membership[id] = [...(membership[id] || []), RECENT_AUTO_LIST_ID]));
  }
  if (highlightedIds.length) {
    lists.push({ id: HIGHLIGHTS_AUTO_LIST_ID, label: 'Highlights', parentId: null, kind: 'list', items: highlightedIds, auto: true, total: totalOf(highlightEntries) });
    highlightedIds.forEach((id) => (membership[id] = [...(membership[id] || []), HIGHLIGHTS_AUTO_LIST_ID]));
  }
  if (notedIds.length) {
    lists.push({ id: NOTES_AUTO_LIST_ID, label: 'Notes', parentId: null, kind: 'list', items: notedIds, auto: true, total: totalOf(noteEntries) });
    notedIds.forEach((id) => (membership[id] = [...(membership[id] || []), NOTES_AUTO_LIST_ID]));
  }

  return { lists, membership, notes, highlights, visited };
}
