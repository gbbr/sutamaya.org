export type ShortcutScope = 'library' | 'reader';

export interface Shortcut {
  // The exact value(s) a keydown handler compares against — `e.key`, or `e.key.toLowerCase()` for
  // the case-insensitive letter shortcuts. Both the handlers and the "?" help modal read it, so the
  // displayed key can't drift from what the key does. Checked with `.includes(e.key)`, never `===`.
  match: string[];
  // Human-readable key caps shown in the help modal, same order as `match`.
  keys: string[];
  label: string;
  scope: ShortcutScope;
  // Requires Shift to be held. Opt-in, since isShortcut() otherwise ignores Shift entirely — set it
  // on a shortcut whose action shouldn't be one stray keypress away.
  shift?: true;
}

export const SHORTCUTS = {
  // Library (LibraryPage.tsx, TreePane.tsx). librarySelectMove/librarySelectOpen belong to
  // TreePane's search-hit navigation alone: only a search result carries a highlight for the arrows
  // to move and Enter to open.
  librarySearch: { match: ['/'], keys: ['/'], label: 'Search the library (Esc to close)', scope: 'library' },
  libraryToggleLists: { match: ['x'], keys: ['X'], label: 'Switch Library / My Lists', scope: 'library' },
  librarySelectMove: { match: ['ArrowUp', 'ArrowDown'], keys: ['↑', '↓'], label: 'Move through the search results', scope: 'library' },
  librarySelectOpen: { match: ['Enter'], keys: ['Enter'], label: 'Open the highlighted search result', scope: 'library' },
  libraryTheme: { match: ['d'], keys: ['⇧D'], label: 'Switch light / dark', scope: 'library', shift: true },
  libraryHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'library' },

  // Reader (ReaderPage.tsx)
  readerClose: { match: ['Escape'], keys: ['Esc'], label: 'Close the dictionary, panel, or the reader', scope: 'reader' },
  readerSearch: { match: ['/'], keys: ['/'], label: 'Search suttas (Esc to close)', scope: 'reader' },
  // Sutta-to-sutta nav is on J/K rather than the arrows, which belong to the dictionary dock's word
  // stepping below; Shift+Arrow is the browser's own extend-selection gesture. They follow the
  // keys' physical positions — J is left of K, so J goes back and K forward — matching the
  // horizontal movement the reader sees animate. Shift is required: leaving the reader mid-sutta
  // shouldn't be one stray keypress away.
  readerNav: { match: ['j', 'k'], keys: ['⇧J', '⇧K'], label: 'Previous / next sutta', scope: 'reader', shift: true },
  readerDictNav: {
    match: ['ArrowLeft', 'ArrowRight'],
    keys: ['←', '→'],
    label: 'Previous / next word in the dictionary',
    scope: 'reader',
  },
  readerHighlights: { match: ['h'], keys: ['H'], label: 'Open the highlights panel', scope: 'reader' },
  // Shares H with the panel above, so the handler has to test this one first — isShortcut() ignores
  // Shift for any shortcut that doesn't ask for it, which means plain `readerHighlights` matches
  // Shift+H too (see useReaderKeyboard).
  readerHighlightsToggle: { match: ['h'], keys: ['⇧H'], label: 'Show / hide highlights', scope: 'reader', shift: true },
  readerLists: { match: ['l'], keys: ['L'], label: 'Open the lists panel', scope: 'reader' },
  readerNote: { match: ['n'], keys: ['N'], label: 'Add a note', scope: 'reader' },
  readerTheme: { match: ['t'], keys: ['T'], label: 'Open the appearance panel', scope: 'reader' },
  readerThemeCycle: { match: ['d'], keys: ['⇧D'], label: 'Light / sepia / dark', scope: 'reader', shift: true },
  readerNotesToggle: { match: ['c'], keys: ['C'], label: 'Toggle translator notes', scope: 'reader' },
  readerHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'reader' },
} satisfies Record<string, Shortcut>;

// Whether to draw a key hint on a control that also has a shortcut. Keyed off pointer type, not
// viewport width: a tablet gets the desktop layout at the size it usually runs, and advertising
// keys there names something its reader has no way to press. Read once — a device doesn't change
// pointer type mid-session, and a missing matchMedia (tests, SSR) falls through to showing them.
export const SHOWS_KEY_HINTS =
  typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches;

export function shortcutsForScope(scope: ShortcutScope): Shortcut[] {
  return Object.values(SHORTCUTS).filter((s) => s.scope === scope);
}

// Modifier-click gestures listed in the same "?" modal as the key shortcuts above. Not part of
// SHORTCUTS: they carry no `match`, since a pointer handler reads `e.altKey` directly instead.
export interface PointerHint {
  keys: string[];
  label: string;
  scope: ShortcutScope;
}

export const POINTER_HINTS: PointerHint[] = [
  { keys: ['⌥', 'Click'], label: 'Collapse a tree row and everything inside it', scope: 'library' },
];

export function pointerHintsForScope(scope: ShortcutScope): PointerHint[] {
  return POINTER_HINTS.filter((h) => h.scope === scope);
}

// True if `e` triggers `shortcut`. Checks `e.key` both as-is and lowercased, so call sites don't
// need to know whether a shortcut is a case-insensitive letter ('h', 'x') or an exact key
// ('Enter', 'Escape', 'ArrowUp', '/', '?'). Ignores Ctrl/Cmd/Alt combos, so a single-key shortcut
// can't hijack a browser or OS chord sharing its letter. Shift is consulted only for a shortcut
// that asks for it: every other one stays Shift-agnostic, since '?' is only reachable as Shift+/.
export function isShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  shortcut: Shortcut
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (shortcut.shift && !e.shiftKey) return false;
  return shortcut.match.includes(e.key) || shortcut.match.includes(e.key.toLowerCase());
}

// True if `e` targets a text input or textarea — the bail-out that keeps a single-key shortcut from
// firing while the user is typing into a field.
export function isTypingTarget(e: Pick<KeyboardEvent, 'target'>): boolean {
  const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea';
}
