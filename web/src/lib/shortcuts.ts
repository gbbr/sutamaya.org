export type ShortcutScope = 'library' | 'reader';

export interface Shortcut {
  // The exact value(s) an actual keydown handler compares against (`e.key`, or `e.key.toLowerCase()`
  // for the case-insensitive letter shortcuts) — the single source of truth every `onKey` handler
  // and the "?" help modal both read from, so the displayed key can never drift from what the key
  // actually does. Checked with `.includes(e.key)`, never `===`, even for a single-key shortcut,
  // so every call site uses the same pattern.
  match: string[];
  // Human-readable key caps shown in the help modal, same order as `match`.
  keys: string[];
  label: string;
  scope: ShortcutScope;
  // Requires Shift to be held. Opt-in, because isShortcut() otherwise ignores Shift entirely
  // (see its own comment) — set it on a shortcut whose action shouldn't be one stray keypress
  // away, the way the theme toggle isn't.
  shift?: true;
}

export const SHORTCUTS = {
  // Library (LibraryPage.tsx, TreePane.tsx) — librarySelectMove/librarySelectOpen belong to
  // TreePane's search-hit navigation alone. Browsing the corpus rows is a pointer job; only a
  // search result carries a highlight for the arrows to move and Enter to open.
  librarySearch: { match: ['/'], keys: ['/'], label: 'Search the library (Esc to close)', scope: 'library' },
  libraryToggleLists: { match: ['x'], keys: ['X'], label: 'Switch Library / My Lists', scope: 'library' },
  librarySelectMove: { match: ['ArrowUp', 'ArrowDown'], keys: ['↑', '↓'], label: 'Move through the search results', scope: 'library' },
  librarySelectOpen: { match: ['Enter'], keys: ['Enter'], label: 'Open the highlighted search result', scope: 'library' },
  libraryTheme: { match: ['d'], keys: ['⇧D'], label: 'Switch light / dark', scope: 'library', shift: true },
  libraryHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'library' },

  // Reader (ReaderPage.tsx)
  readerClose: { match: ['Escape'], keys: ['Esc'], label: 'Close the dictionary, panel, or the reader', scope: 'reader' },
  readerSearch: { match: ['/'], keys: ['/'], label: 'Search suttas (Esc to close)', scope: 'reader' },
  // Sutta-to-sutta nav is on K/J rather than the arrows: the arrows belong to the dictionary
  // dock's own word stepping below, and Shift+Arrow — the obvious way to tell the two apart — is
  // the browser's own extend-selection gesture, which is not something to fight on a page whose
  // whole point is selectable text.
  readerNav: { match: ['k', 'j'], keys: ['K', 'J'], label: 'Previous / next sutta', scope: 'reader' },
  readerDictNav: {
    match: ['ArrowLeft', 'ArrowRight'],
    keys: ['←', '→'],
    label: 'Previous / next word in the dictionary',
    scope: 'reader',
  },
  readerHighlights: { match: ['h'], keys: ['H'], label: 'Open the highlights panel', scope: 'reader' },
  readerLists: { match: ['l'], keys: ['L'], label: 'Open the lists panel', scope: 'reader' },
  readerNote: { match: ['n'], keys: ['N'], label: 'Add a note', scope: 'reader' },
  readerTheme: { match: ['t'], keys: ['T'], label: 'Open the display panel', scope: 'reader' },
  readerThemeCycle: { match: ['d'], keys: ['⇧D'], label: 'Light / sepia / dark', scope: 'reader', shift: true },
  readerNotesToggle: { match: ['c'], keys: ['C'], label: 'Toggle translator notes', scope: 'reader' },
  readerHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'reader' },
} satisfies Record<string, Shortcut>;

export function shortcutsForScope(scope: ShortcutScope): Shortcut[] {
  return Object.values(SHORTCUTS).filter((s) => s.scope === scope);
}

// Modifier-click gestures listed in the same "?" modal as the key shortcuts above. Deliberately
// not part of SHORTCUTS: they carry no `match`, since no keydown handler can fire them — a
// pointer handler reads `e.altKey` directly instead.
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

// True if `e` triggers `shortcut` — checks `e.key` both as-is and lowercased, so call sites never
// need to know (or repeat) whether a given shortcut is a case-insensitive letter ('h', 'x', ...)
// or an exact key that must not be lowercased ('Enter', 'Escape', 'ArrowUp', '/', '?'). Ignores
// Ctrl/Cmd/Alt combos (e.g. Cmd+L for the browser's own address-bar focus) so none of our
// single-key shortcuts hijack a browser/OS chord that happens to share a letter. Shift is only
// consulted for a shortcut that asks for it (`shift: true`): every other one stays Shift-agnostic,
// since '?' is itself only reachable as Shift+/.
export function isShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  shortcut: Shortcut
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (shortcut.shift && !e.shiftKey) return false;
  return shortcut.match.includes(e.key) || shortcut.match.includes(e.key.toLowerCase());
}

// True if `e` targets a text input/textarea — the standard bail-out so a single-key shortcut
// (e.g. 'h', '/') doesn't fire while the user is typing into a field.
export function isTypingTarget(e: Pick<KeyboardEvent, 'target'>): boolean {
  const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea';
}
