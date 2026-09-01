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

// Derives what the UI renders from the mirror — the client-side half of the worker's
// assembleUserData (worker/src/lib/userData.js), ported rather than reimplemented so both produce
// the same lists, membership and auto-lists from the same rows.
//
// It exists here because the mirror, not the server, is the source of truth the UI reads: a sutta
// highlighted offline appears under "Highlights" immediately, and a note written offline under
// "Notes", without waiting on a round trip. The server's own copy still serves the pull.

// What the UI renders: the wire's `UserData` shape, except each note is reduced to its text — a
// note's mtime exists to order the Notes auto-list, which happens here. A distinct type rather than
// a reuse of `UserData`, so the compiler tells the two note shapes apart.
export interface DerivedUserData extends Omit<UserData, 'notes'> {
  notes: NotesMap;
}

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

// One record as the reader renders it, or nothing at all where the record is a pure erase — which
// has a span only to record what the user selected, and paints nothing.
//
// A record with no span at all is dropped rather than rendered, as a cleared note is above: the only
// way to hold one is a mirror persisted by another app version that upgradeStoredMirror didn't
// cover, and losing one highlight is a far better failure than taking the reader down with it.
function highlightOf(record: HighlightRecord): Highlight[] {
  if (!record.color || !record.span) return [];
  const { i0, o0, i1, o1 } = record.span;
  return [{ id: record.g, i0, o0, i1, o1, c: record.color, m: record.mtime }];
}

// Document order, which the reader's highlights panel lists in and the gutter's marks are drawn
// from. Stable under a re-pull, unlike the order records happen to sit in the mirror.
function inDocumentOrder(highlights: Highlight[]): Highlight[] {
  return highlights.sort((a, b) => a.i0 - b.i0 || a.o0 - b.o0 || (a.id < b.id ? -1 : 1));
}

// One sutta's highlights — what displacedIds needs in order to work out which a fresh selection
// displaces (see lib/mirror.ts's writeHighlightRecord).
export function highlightsFor(state: MirrorState, suttaId: string): Highlight[] {
  return Object.values(state.highlights)
    .filter((record) => record.data.suttaId === suttaId)
    .flatMap((record) => highlightOf(record.data));
}

export function deriveUserData(state: MirrorState): DerivedUserData {
  const membership: Membership = {};
  // repairListTree decides which lists survive — dropping tombstones and everything beneath them —
  // as well as their order and, where a stored parentId dangles, the parentId each is shaped with.
  // `position`/`mtime`/`deleted` feed that repair and stop here.
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
    // old body back, but "has a note" means non-empty text, here as on the server. The typeof guard
    // covers a mirror persisted by a different app version (mirrorDb.ts has no schema migration):
    // a malformed record drops the note rather than crashing the reader.
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

  // Most-recent first, since an auto-list has no stored order the way a real list has, and capped
  // because ListPane renders every item as an unvirtualized DOM row.
  const recentIds = latestIds(visitedEntries, VISITED_AUTO_LIST_CAP);
  const highlightedIds = latestIds(highlightEntries, AUTO_LIST_CAP);
  const notedIds = latestIds(noteEntries, AUTO_LIST_CAP);

  // How many suttas the cap left out, so the header can own up to it. Counted over distinct suttas,
  // matching what latestIds returns — a sutta with four highlights is one row in that list, not four.
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
