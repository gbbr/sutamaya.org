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
  // Recursive: SN nests groups > chapters > vagga categories, AN nests chapters > vagga
  // categories, MN nests categories directly — a row with `chapters` expands further, one
  // without is where suttas live (see isExpandable() in lib/corpus.ts).
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
  // rendered text does — an update-data refresh, a retranslation rule, a change to the builder
  // itself. Since per-sutta text is cached under unversioned CacheFirst URLs, this is the only
  // way a device can tell its offline copy has fallen behind (see lib/offline.ts).
  dataVersion: string;
  // The same, for dictionary.json — kept separate so a text-only change never prompts a ~20MB
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
  // lib/highlights.ts's groupHighlights). Minted by the client when the user picks the colour, so
  // a highlight made offline already has its final identity.
  g: string;
  // The group's mtime (`${ISO}|${deviceId}`, see lib/mtime.ts). Two devices' overlapping
  // highlights can both survive now, so this — with `g` as the tiebreak — is what decides which
  // one paints the characters they contest (paintSegmentHighlights).
  m: string;
}

// 'list' holds suttas (`items`) and can't have children. 'group' ("ListGroup") is the reverse:
// it can only contain other lists/groups and can never hold items itself — see
// worker/src/routes/lists.js's invalidParentReason, which enforces this server-side too.
export type ListKind = 'list' | 'group';

export interface ListDef {
  id: string;
  label: string;
  parentId: string | null;
  kind: ListKind;
  // Ordered array of sutta uids — this list's own contents, in the order the user put them in
  // (or reordered them to). See lib/corpus.ts's listItemsFor, which uses this order instead of
  // re-sorting a list's contents by sutta id the way browsing a nikaya/category does. Always
  // empty for a `kind: 'group'` entry.
  items: string[];
  // True for the auto-managed lists ("Recent", "Highlights", "Notes") synthesized server-side in
  // buildUserData() from the visited/highlights/notes tables — not a real `lists` row, so
  // it can't be renamed, deleted, reparented, or have its own items reordered.
  auto?: boolean;
}

// A dragged list row's position relative to a drop-target row in TreePane's "My lists" tree —
// 'before'/'after' reorders it as a sibling, 'inside' nests it as a child (target must be a
// group). Shared between ListRow.tsx (rendering the drop-target highlight) and
// useListTreeDrag.ts (computing it), so it lives here rather than in either.
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

// 'system' is the starting value rather than one of the offered choices: neither picker lists it,
// and both show whichever theme it currently resolves to as the selected one, so a reader who has
// never touched the setting follows the OS and one who has picked stays put. See
// ResolvedReaderTheme / ResolvedAppTheme below for the resolved side.
export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'system';
// What 'system' actually resolves to at render time — see ReaderPrefsContext's live
// prefers-color-scheme tracking.
export type ResolvedReaderTheme = Exclude<ReaderTheme, 'system'>;
export type ReaderFace = 'serif' | 'georgia' | 'sans' | 'system' | 'times';

// The app shell's own light/dark mode (Settings > Theme) — distinct from ReaderTheme, which is
// the immersive reader's separate preference and unaffected by this. 'system' follows the OS's
// prefers-color-scheme; see lib/uiPrefs.ts's applyTheme().
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
  // A lighter, lower-alpha fill than `rule` — for a filled pill/badge background (e.g.
  // HighlightCountBadge) that needs to read as a subtle tint rather than a visible border tone.
  tint: string;
  // Even more washed than `tint` — for a wash spanning a large block (e.g. a whole verse's worth
  // of segment rows in SegmentedText's focusUid marker) rather than a small badge/word; the same
  // alpha as `tint` reads as a much stronger fill once it covers that much more area, light theme
  // especially (its bright background gives the least room before a fill starts looking like a
  // real highlight rather than a quiet "you are here" marker).
  focusTint: string;
  // 1 (opaque) for light/sepia, where a HIGHLIGHT_COLORS pastel already reads as a soft wash
  // against those bright backgrounds; <1 for dark, where painting the same opaque pastel would
  // read as a bright, attention-grabbing patch — see lib/theme.ts's highlightPaint().
  highlightAlpha: number;
  // The native text-selection background, scoped to the reader (see index.css's
  // `[data-component="ReaderPage"] ::selection` and ReaderPage's `--reader-selection`) — kept
  // separate from the app shell's own `--selection` CSS var (index.css), which follows the UI's
  // light/dark toggle rather than the reader's own theme.
  selection: string;
}
