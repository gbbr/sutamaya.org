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
}

export const SHORTCUTS = {
  // Library (LibraryPage.tsx, TreePane.tsx) — librarySelectMove/librarySelectOpen are shared by
  // TreePane's own search-hit navigation and LibraryPage's browse-row navigation, since both are
  // the same "arrow to move the highlight, enter to open it" action applied to two different lists.
  librarySearch: { match: ['/'], keys: ['/'], label: 'Search the library (Esc to close)', scope: 'library' },
  libraryToggleLists: { match: ['x'], keys: ['X'], label: 'Switch Library / My Lists (signed in)', scope: 'library' },
  librarySelectMove: { match: ['ArrowUp', 'ArrowDown'], keys: ['↑', '↓'], label: 'Move the highlighted row (or search result)', scope: 'library' },
  librarySelectOpen: { match: ['Enter'], keys: ['Enter'], label: 'Open the highlighted sutta', scope: 'library' },
  libraryHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'library' },

  // Reader (ReaderPage.tsx)
  readerClose: { match: ['Escape'], keys: ['Esc'], label: 'Close the dictionary, panel, or the reader', scope: 'reader' },
  readerSearch: { match: ['/'], keys: ['/'], label: 'Search suttas (Esc to close)', scope: 'reader' },
  // Same `match` on both — deliberately: it's Shift that distinguishes them, and isShortcut()
  // itself doesn't check Shift (see its own comment), so the ReaderPage keydown handler checks
  // e.shiftKey directly rather than relying on `match` to tell the two apart.
  readerNav: { match: ['ArrowLeft', 'ArrowRight'], keys: ['⇧←', '⇧→'], label: 'Previous / next sutta', scope: 'reader' },
  readerDictNav: {
    match: ['ArrowLeft', 'ArrowRight'],
    keys: ['←', '→'],
    label: 'Previous / next word in the dictionary',
    scope: 'reader',
  },
  readerHighlights: { match: ['h'], keys: ['H'], label: 'Open the highlights panel', scope: 'reader' },
  readerLists: { match: ['l'], keys: ['L'], label: 'Open the lists panel', scope: 'reader' },
  readerNote: { match: ['n'], keys: ['N'], label: 'Add a note', scope: 'reader' },
  readerTheme: { match: ['t'], keys: ['T'], label: 'Open the theme panel', scope: 'reader' },
  readerNotesToggle: { match: ['c'], keys: ['C'], label: 'Toggle translator notes', scope: 'reader' },
  readerHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'reader' },
} satisfies Record<string, Shortcut>;

export function shortcutsForScope(scope: ShortcutScope): Shortcut[] {
  return Object.values(SHORTCUTS).filter((s) => s.scope === scope);
}

// True if `e` triggers `shortcut` — checks `e.key` both as-is and lowercased, so call sites never
// need to know (or repeat) whether a given shortcut is a case-insensitive letter ('h', 'x', ...)
// or an exact key that must not be lowercased ('Enter', 'Escape', 'ArrowUp', '/', '?'). Ignores
// Ctrl/Cmd/Alt combos (e.g. Cmd+L for the browser's own address-bar focus) so none of our
// single-key shortcuts hijack a browser/OS chord that happens to share a letter; Shift is exempt
// since '?' is only reachable as Shift+/.
export function isShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, shortcut: Shortcut): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return shortcut.match.includes(e.key) || shortcut.match.includes(e.key.toLowerCase());
}

// True if `e` targets a text input/textarea — the standard bail-out so a single-key shortcut
// (e.g. 'h', '/') doesn't fire while the user is typing into a field.
export function isTypingTarget(e: Pick<KeyboardEvent, 'target'>): boolean {
  const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea';
}
