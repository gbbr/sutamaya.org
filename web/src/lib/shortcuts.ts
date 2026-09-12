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
  // Fires even while a text field has focus. Opt-in, and only for a key that means the same thing
  // mid-edit as it does anywhere else — Escape, which is how you leave whatever you are in. Every
  // other shortcut is a character somebody may be typing.
  whileTyping?: true;
}

export const SHORTCUTS = {
  // Library (LibraryPage.tsx, TreePane.tsx). librarySelectMove/librarySelectOpen belong to
  // TreePane's search-hit navigation alone: only a search result carries a highlight for the arrows
  // to move and Enter to open.
  librarySearch: { match: ['/'], keys: ['/'], label: 'Search the library (Esc to close)', scope: 'library' },
  libraryToggleLists: { match: ['x'], keys: ['X'], label: 'Switch Library / My Lists', scope: 'library' },
  // These two run with the search input focused, that being the normal state while results are up,
  // and they are movement keys rather than characters anyone is typing. TreePane narrows them
  // further to that one field.
  librarySelectMove: {
    match: ['ArrowUp', 'ArrowDown'],
    keys: ['↑', '↓'],
    label: 'Move through the search results',
    scope: 'library',
    whileTyping: true,
  },
  librarySelectOpen: {
    match: ['Enter'],
    keys: ['Enter'],
    label: 'Open the highlighted search result',
    scope: 'library',
    whileTyping: true,
  },
  libraryTheme: { match: ['d'], keys: ['⇧D'], label: 'Switch light / dark', scope: 'library', shift: true },
  // The set-aside bar is on screen here as well as in the reader, so its slots answer to the same
  // keys in both. Bare digits, since the modifier a browser puts on these is exactly the one
  // isShortcut() refuses so that Cmd+1 stays the browser's own.
  librarySetAsideSlot: {
    match: ['1', '2', '3', '4', '5'],
    keys: ['1–5'],
    label: 'Open the 1st–5th sutta set aside',
    scope: 'library',
  },
  libraryHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'library' },

  // Reader (ReaderPage.tsx)
  readerClose: {
    match: ['Escape'],
    keys: ['Esc'],
    label: 'Close the dictionary, panel, or the reader',
    scope: 'reader',
    whileTyping: true,
  },
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
  // Shift for the same reason ⇧J/⇧K carry it: this leaves the reading, which shouldn't be one
  // stray keypress away.
  readerSetAside: { match: ['a'], keys: ['⇧A'], label: 'Set this sutta aside', scope: 'reader', shift: true },
  readerSetAsideSlot: {
    match: ['1', '2', '3', '4', '5'],
    keys: ['1–5'],
    label: 'Open the 1st–5th sutta set aside',
    scope: 'reader',
  },
  readerHelp: { match: ['?'], keys: ['?'], label: 'Show keyboard shortcuts', scope: 'reader' },
} satisfies Record<string, Shortcut>;

// Whether to draw key hints on the controls that have shortcuts. Keyed off pointer type rather
// than viewport width, since a tablet gets the desktop layout but has no keys to press. Read once,
// a device not changing pointer type mid-session.
export const SHOWS_KEY_HINTS =
  typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches;

export function shortcutsForScope(scope: ShortcutScope): Shortcut[] {
  return Object.values(SHORTCUTS).filter((s) => s.scope === scope);
}

// A modifier-click gesture, listed in the same "?" modal as the key shortcuts. Separate from
// SHORTCUTS, since a pointer handler reads `e.altKey` itself and needs no `match`.
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

// True if `e` triggers `shortcut`, matching `e.key` as-is and lowercased so a call site needn't
// know whether the shortcut is a letter or an exact key name.
//
// Three things are refused here rather than at the call sites, so a new shortcut is safe by being
// declared rather than by its handler remembering: a Ctrl/Cmd/Alt combo, so no single-key shortcut
// can hijack a browser chord; a missing Shift, where the shortcut asks for one ('?' being reachable
// only as Shift+/); and **anything typed into a text field**, since every shortcut here is a
// character somebody may be writing into the library's search, the reader's, a note or a list's
// name. `whileTyping` is the opt-out, and Escape is the only thing that takes it.
export function isShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>,
  shortcut: Shortcut
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (shortcut.shift && !e.shiftKey) return false;
  if (!shortcut.whileTyping && isTypingTarget(e)) return false;
  return shortcut.match.includes(e.key) || shortcut.match.includes(e.key.toLowerCase());
}

// True if `e` targets somewhere text is being written, which is where a single-key shortcut stands
// down. `contenteditable` alongside the real fields, so a rich editor added later is covered by
// being one; read from the attribute as well as the property, jsdom implementing only the former.
export function isTypingTarget(e: Pick<KeyboardEvent, 'target'>): boolean {
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el?.isContentEditable) return true;
  const editable = el?.closest?.('[contenteditable]');
  return !!editable && editable.getAttribute('contenteditable') !== 'false';
}
