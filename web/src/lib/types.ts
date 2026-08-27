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
  // Bhikkhu Sujato's description of this group, where the source data has one: DN's 3 vaggas,
  // MN's 15, Snp's 5, Ud's 8, and in SN both the 5 books and all 56 saṁyuttas. AN has none at
  // any level, nor do the four KN books that hold their documents directly. May contain inline
  // HTML, like a sutta's translator note does. Read it with nodeBlurb() in lib/corpus.ts, which
  // handles SN writing its descriptions a level above the rows that display them.
  blurb?: string;
  // Recursive: SN nests groups > chapters > vagga categories, AN nests chapters > vagga
  // categories, MN nests categories directly. A row with `chapters` expands further; one without is
  // where suttas live (see isExpandable() in lib/corpus.ts).
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
  // The suttacentral/sc-data commit data/{sujato,pali,html}/ were last synced from
  // (data/manifest.json's sourceCommit) — used to link the reader's translation attribution to
  // the exact source revision.
  sujatoCommit: string;
  // Digest of the built sutta text (scripts/build-corpus.mjs), changing whenever any sutta's
  // rendered text does. Per-sutta text is cached under unversioned CacheFirst URLs, so this is the
  // only way a device can tell its offline copy has fallen behind (see lib/offline.ts).
  dataVersion: string;
  // The same, for the dictionary — kept separate so a text-only change doesn't prompt a full
  // dictionary re-download.
  dictionaryVersion: string;
}

export interface Segment {
  key: string;
  pali: string;
  en: string;
}

export type Dictionary = Record<string, string[]>;

export interface Highlight {
  id: string;
  i: number;
  s: number;
  e: number;
  c: string;
  // The group this row belongs to — one selection, one group, one row per segment it spans (see
  // lib/highlights.ts's groupHighlights). Minted by the client when the user picks the colour, so a
  // highlight made offline already has its final identity.
  g: string;
  // The group's mtime (`${ISO}|${deviceId}`, see lib/mtime.ts). Two devices' overlapping highlights
  // can both survive, so this — with `g` as the tiebreak — decides which one paints the characters
  // they contest (paintSegmentHighlights).
  m: string;
}

// 'list' holds suttas (`items`) and can't have children; 'group' is the reverse, holding only other
// lists and groups. worker/src/routes/lists.js's invalidParentReason enforces this server-side too.
export type ListKind = 'list' | 'group';

export interface ListDef {
  id: string;
  label: string;
  parentId: string | null;
  kind: ListKind;
  // Ordered array of sutta uids, in the order the user put them in. lib/corpus.ts's listItemsFor
  // keeps this order rather than re-sorting by sutta id the way browsing a nikaya does. Always
  // empty for a `kind: 'group'` entry.
  items: string[];
  // True for the auto-managed lists ("Visited", "Highlights", "Notes"), synthesized from the
  // visited/highlights/notes records rather than stored as `lists` rows — so they can't be renamed,
  // deleted, reparented, or reordered. See lib/autoLists.ts.
  auto?: boolean;
}

// A dragged list row's position relative to a drop-target row in TreePane's "My lists" tree:
// 'before'/'after' reorders it as a sibling, 'inside' nests it as a child of a group. Shared by
// ListRow.tsx, which paints the drop-target highlight, and useListTreeDrag.ts, which computes it.
export type DropZone = 'before' | 'after' | 'inside';

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

// 'system' is the starting value, and the reader's picker doesn't list it: it shows whichever theme
// 'system' currently resolves to as the selected one, so a reader who has never touched the setting
// follows the OS and one who has picked stays put. Settings' shell picker does offer System — see
// AppTheme.
export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'system';
// What 'system' resolves to at render time — see ReaderPrefsContext's prefers-color-scheme tracking.
export type ResolvedReaderTheme = Exclude<ReaderTheme, 'system'>;
// Six faces, laid out by the reader's picker as a 3×2 grid of specimen tiles — see
// ReaderMenuPanel's FACE_OPTIONS.
export type ReaderFace = 'georgia' | 'serif' | 'literata' | 'charter' | 'palatino' | 'sans';

// The app shell's light/dark mode (Settings > Theme), separate from ReaderTheme and unaffected by
// it. 'system' follows the OS's prefers-color-scheme; see lib/uiPrefs.ts's applyTheme().
export type AppTheme = 'light' | 'dark' | 'system';
// The counterpart to ResolvedReaderTheme for the shell — see UiPrefsContext's matchMedia tracking.
export type ResolvedAppTheme = Exclude<AppTheme, 'system'>;

export interface ThemeColors {
  bg: string;
  fg: string;
  dim: string;
  rule: string;
  panel: string;
  pali: string;
  // A lighter, lower-alpha fill than `rule`, for a pill or badge background that should read as a
  // subtle tint rather than a border tone.
  tint: string;
  // The same, in this theme's accent hue rather than its ink — for a pill that has to be told apart
  // from the neutral `tint` fills beside it, which is what HighlightCountBadge needs next to the
  // list-membership chips.
  paliTint: string;
  // More washed than `tint`, for a wash spanning a large block rather than a badge or word —
  // SegmentedText's focusUid marker covers a whole verse, where `tint`'s alpha would read as a real
  // highlight instead of a quiet "you are here".
  focusTint: string;
  // This theme's own highlight fills, index-aligned with HIGHLIGHT_COLORS, or null to paint the
  // stored color itself. Only dark carries a palette — see lib/theme.ts's highlightPaint().
  highlightPalette: readonly string[] | null;
  // The native text-selection background, scoped to the reader (index.css's
  // `[data-component="ReaderPage"] ::selection` and ReaderPage's `--reader-selection`). Separate
  // from the shell's `--selection`, which follows the UI's light/dark toggle rather than the
  // reader's theme.
  selection: string;
}
