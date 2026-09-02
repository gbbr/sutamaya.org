export interface Sutta {
  ref: string;
  node: string;
  en: string;
  pali: string;
  blurb: string;
  min: number;
}

export type SuttaMap = Record<string, Sutta>;

export interface ChapterRow {
  id: string;
  ref: string;
  label: string;
  sub?: string;
  count: number;
  // Bhikkhu Sujato's description of this group, where the source data has one; may contain inline
  // HTML. Read it with nodeBlurb() (lib/corpus.ts), which handles the inconsistent depths.
  blurb?: string;
  // This row's children, at whatever depth the collection nests to. A row with them expands
  // further; one without is where suttas live.
  chapters?: ChapterRow[];
}

export interface Nikaya {
  id: string;
  label: string;
  sub: string;
  count: number;
  chapters?: ChapterRow[];
}

export interface Corpus {
  nikayas: Nikaya[];
  suttas: SuttaMap;
  // The suttacentral/sc-data commit the text was last synced from, which the reader's translation
  // attribution links to.
  sujatoCommit: string;
  // Digest of the built sutta text, changing whenever any sutta's rendered text does. Per-sutta
  // text is cached under unversioned URLs, so this is how a device tells its copy has fallen
  // behind.
  dataVersion: string;
  // The same for the dictionary, kept separate so a text change costs no dictionary re-download.
  dictionaryVersion: string;
}

export interface Segment {
  key: string;
  pali: string;
  en: string;
}

export type Dictionary = Record<string, string[]>;

// One highlight: the span from (i0, o0) up to but not including (i1, o1), `i` being a segment
// index and `o` a character offset into that segment's English. A selection within one segment has
// i0 === i1.
//
// Two endpoints rather than a range per segment covered, so everything between is covered by
// definition and a segment reworded or inserted upstream can't leave a gap mid-highlight. Only the
// two endpoints drift — see docs/offline-sync.md.
export interface Highlight {
  // Minted by the client when the colour is picked, so a highlight made offline has its final
  // identity at once.
  id: string;
  i0: number;
  o0: number;
  i1: number;
  o1: number;
  c: string;
  // The mtime (lib/mtime.ts), which with `id` decides which of two overlapping highlights paints
  // the characters they contest.
  m: string;
}

// 'list' holds suttas and no children; 'group' holds only other lists and groups. The server
// enforces this too.
export type ListKind = 'list' | 'group';

export interface ListDef {
  id: string;
  label: string;
  parentId: string | null;
  kind: ListKind;
  // The list's suttas, in the order the reader put them in. Always empty for a group.
  items: string[];
  // True for an auto-managed list, which can't be renamed, deleted, reparented or reordered. See
  // lib/autoLists.ts.
  auto?: boolean;
  // Auto-lists only: how many suttas qualify, before the cap trimmed `items` to the most recent.
  // Equal to `items.length` until the cap bites, and what ListPane's "Showing 100 of 340" reads.
  total?: number;
}

// Where a dragged list row would land relative to the row under the pointer.
//   before – as that row's sibling, above it
//   inside – nested at the end of that group
//   end    – the end of the top level, which is how a list leaves the group it is in
export type DropZone = 'before' | 'inside' | 'end';

export type Membership = Record<string, string[]>;
export type NotesMap = Record<string, string>;
export type HighlightsMap = Record<string, Highlight[]>;
export type VisitedMap = Record<string, string>;

export interface User {
  id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
}

// The reader's own theme. 'system' is the starting value and the reader's picker doesn't list it,
// showing whichever theme it resolves to as the selected one; Settings' shell picker does offer it.
export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'system';
// What 'system' resolves to at render time.
export type ResolvedReaderTheme = Exclude<ReaderTheme, 'system'>;
// The reading faces, drawn as specimen tiles in the reader's picker.
export type ReaderFace = 'georgia' | 'serif' | 'literata' | 'charter' | 'palatino' | 'sans';

// The app shell's light/dark mode (Settings > Theme), separate from the reader's own.
export type AppTheme = 'light' | 'dark' | 'system';
// What that 'system' resolves to at render time.
export type ResolvedAppTheme = Exclude<AppTheme, 'system'>;

export interface ThemeColors {
  bg: string;
  fg: string;
  dim: string;
  rule: string;
  panel: string;
  pali: string;
  // A pill or badge fill in this theme's ink, lighter than `rule`.
  tint: string;
  // The same in the accent hue, for a pill that has to be told from the neutral ones beside it.
  paliTint: string;
  // A wash for a whole block rather than a badge, more washed than `tint`.
  focusTint: string;
  // This theme's own highlight fills, index-aligned with HIGHLIGHT_COLORS, or null to paint the
  // stored colour itself. Only dark carries a palette.
  highlightPalette: readonly string[] | null;
  // The native text-selection background inside the reader, separate from the shell's, which
  // follows the UI theme rather than the reader's.
  selection: string;
}
