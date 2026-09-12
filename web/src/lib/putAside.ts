// The put-aside set: the handful of suttas a reader is consulting alongside the one on screen,
// each remembered at the line they left it on.
//
// **They behave as browser tabs.** Every member has a tab, the sutta on screen is drawn as the
// active one, and slots never move, so a tab stays where the finger last found it. A tab follows
// the reading it holds — the line it remembers is wherever that sutta was last left, as a browser
// tab holds its scroll.
//
// **A sutta joins the bar when the reader sets it aside, and leaves when they close it.** Nothing
// else moves the set: switching tabs, closing the reader and stepping to the next sutta all leave
// it exactly as it stands, and nothing already in it is dropped to make room for something else —
// at the cap the reader is asked what should go. So the set only ever changes by their own hand.
//
// The one departure from a browser is that reading a sutta does not give it a tab — that would make
// this the Visited list it is defined against. Reading is where a browser has no equivalent, since
// there nothing is ever open without a tab; the minimise control is what says this reading should
// be kept within reach.
//
// It syncs as **one record holding the whole ordered set**, not one row per sutta, which is what
// keeps it free of tombstones: a removal is simply "the newer set doesn't list it", so an older
// device pushing a stale set loses on `mtime` and resurrects nothing. The cost is last-writer-wins
// over the whole set rather than per member — two devices each putting a different sutta aside
// while both offline means one set wins. For a transient working set that is the right trade;
// recovery is opening the sutta again.
//
// Every function here is a pure transformation of the entry array. lib/mirror.ts stamps the mtime
// and marks it dirty; UserDataContext exposes them.

/**
 * One put-aside sutta, remembered at the line the reader left it on.
 *
 * The position is a segment key rather than a scroll offset because the set crosses devices: an
 * offset means nothing on another screen size, and nothing under this app's own typography
 * controls. `pct` rides alongside purely as the bar's label, so a device that has never downloaded
 * this sutta can still say how far in it was without loading its text.
 */
export interface PutAsideEntry {
  suttaId: string;
  /**
   * SuttaCentral's segment id (`mn10:2.7`) for the line at the top of the reading, or
   * `READING_TOP` (lib/readingPosition.ts) for a sutta left unscrolled, whose heading is above
   * every segment and so has no key of its own.
   */
  key: string;
  /** How far through the sutta that line is, 0–100. */
  pct: number;
}

/**
 * Most suttas the set holds, the sutta being read included.
 *
 * Past this the phone's bar is only ever a sheet-opener, and the set stops being a hand-picked few
 * and becomes the Visited list it is defined against. A full set turns the reader's minimise
 * control into the sheet, where they close one tab and the sutta they were reading takes its place.
 *
 * Duplicated in worker/src/lib/writes.js, no module being shared between the two workspaces.
 */
export const PUT_ASIDE_CAP = 5;

/** True where `entries` is a well-formed set — the guard every path that reads stored data uses. */
export function isPutAsideEntry(value: unknown): value is PutAsideEntry {
  const entry = value as PutAsideEntry | null;
  return (
    !!entry &&
    typeof entry.suttaId === 'string' &&
    !!entry.suttaId &&
    typeof entry.key === 'string' &&
    typeof entry.pct === 'number' &&
    Number.isFinite(entry.pct)
  );
}

/**
 * Normalises a set read from storage or the wire: malformed entries dropped, duplicates resolved
 * to the first occurrence, and the whole thing capped.
 */
export function normalizePutAside(value: unknown): PutAsideEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: PutAsideEntry[] = [];
  for (const raw of value) {
    if (!isPutAsideEntry(raw)) continue;
    if (seen.has(raw.suttaId)) continue;
    seen.add(raw.suttaId);
    entries.push(entryOf(raw));
  }
  // Trimmed from the front, the oldest tab being the one that falls off.
  return entries.slice(-PUT_ASIDE_CAP);
}

function entryOf(entry: PutAsideEntry): PutAsideEntry {
  return { suttaId: entry.suttaId, key: entry.key, pct: clampPct(entry.pct) };
}

function clampPct(pct: number): number {
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * The one tab the phone's single slot shows: the last the reader left, which is the way back.
 *
 * Falls to the active tab where there is no other, so the bar keeps its place rather than vanishing
 * under a reader who has parked exactly one sutta and is reading it.
 */
export function phoneTab(entries: PutAsideEntry[], currentSuttaId?: string): PutAsideEntry | null {
  const others = entries.filter((e) => e.suttaId !== currentSuttaId);
  return others[others.length - 1] ?? entries[entries.length - 1] ?? null;
}

/**
 * Puts a sutta aside — what the reader's minimise control does, and what leaving one for another
 * tab does to the reading left behind.
 *
 * The new tab joins the end, as a browser's does, so no existing slot moves. A sutta already in the
 * set keeps its slot and has only its position refreshed.
 *
 * The cap is enforced here as a floor under a set arriving full from another device mid-gesture,
 * the oldest falling off the front. What a reader meets is the bar's own gate: at the cap the
 * minimise control asks them to close a tab first, so this never trims what is on their screen.
 */
export function addPutAside(entries: PutAsideEntry[], entry: PutAsideEntry): PutAsideEntry[] {
  const tracked = trackPutAside(entries, entry);
  if (tracked !== entries) return tracked;
  return [...entries, entryOf(entry)].slice(-PUT_ASIDE_CAP);
}

/**
 * Moves a tab to the line its sutta is now left on, the way a browser tab holds its scroll.
 *
 * A sutta the set doesn't hold is left out of it: having been read is not what earns a tab. Every
 * way out of a reading calls this, so a tab is never offering a line the reader has long since
 * passed.
 */
export function trackPutAside(entries: PutAsideEntry[], entry: PutAsideEntry): PutAsideEntry[] {
  const held = entries.findIndex((e) => e.suttaId === entry.suttaId);
  if (held < 0) return entries;
  return entries.map((e, i) => (i === held ? entryOf(entry) : e));
}

/** Drops one sutta from the set — a tab's ✕ or a row's bin, the only ways out of it. */
export function removePutAside(entries: PutAsideEntry[], suttaId: string): PutAsideEntry[] {
  return entries.filter((e) => e.suttaId !== suttaId);
}
