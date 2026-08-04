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
}

export interface ListDef {
  id: string;
  label: string;
}

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

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFace = 'serif' | 'georgia' | 'sans';

export interface ThemeColors {
  bg: string;
  fg: string;
  dim: string;
  rule: string;
  panel: string;
  pali: string;
}
