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
  g: string;
}

// 'list' holds suttas (`items`) and can't have children. 'group' ("ListGroup") is the reverse:
// it can only contain other lists/groups and can never hold items itself — see
// server/src/routes/lists.js's invalidParentReason, which enforces this server-side too.
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
  // buildUserData() from the visited/highlights/notes collections — not a real Firestore doc, so
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

export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'system';
// What 'system' actually resolves to at render time — see ReaderPrefsContext's live
// prefers-color-scheme tracking.
export type ResolvedReaderTheme = Exclude<ReaderTheme, 'system'>;
export type ReaderFace = 'serif' | 'georgia' | 'sans' | 'system' | 'times';

// The app shell's own light/dark mode (Settings > Theme) — distinct from ReaderTheme, which is
// the immersive reader's separate light/dark/system preference and unaffected by this. 'system'
// follows the OS's prefers-color-scheme; see lib/uiPrefs.ts's applyTheme().
export type AppTheme = 'light' | 'dark' | 'system';

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
