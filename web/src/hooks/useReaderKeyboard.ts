import { useEffect } from 'react';
import { useLatest } from './useLatest';
import { SHORTCUTS, isShortcut, isTypingTarget } from '../lib/shortcuts';

interface UseReaderKeyboardOptions {
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  pop: unknown;
  closePop: () => void;
  dict: unknown;
  closeDict: () => void;
  panel: boolean;
  setPanel: (open: boolean) => void;
  closeReader: () => void;
  step: (dir: 1 | -1) => void;
  goToAdjacentWord: (dir: 1 | -1) => void;
  setTab: (tab: 'highlights' | 'lists' | 'text') => void;
  setNoteFocusSignal: (updater: (s: number) => number) => void;
  toggleShowNotes: () => void;
  toggleShowHighlights: () => void;
  cycleTheme: () => void;
}

// All of the reader's single-key shortcuts (see lib/shortcuts.ts's SHORTCUTS.reader*), in one
// window-level keydown listener. The order the branches are checked in is load-bearing — see
// useReaderKeyboard.test.tsx, which covers it per shortcut.
export function useReaderKeyboard(opts: UseReaderKeyboardOptions) {
  const {
    shortcutsOpen,
    setShortcutsOpen,
    searchOpen,
    setSearchOpen,
    menuOpen,
    setMenuOpen,
    pop,
    closePop,
    dict,
    closeDict,
    panel,
    setPanel,
    closeReader,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
    toggleShowHighlights,
    cycleTheme,
  } = opts;
  // `step` and `goToAdjacentWord` are rebuilt on every ReaderPage render and close over the corpus
  // order, the list being read from and the dictionary's current word. Read through a latest ref, so
  // this listener subscribes once and still calls the current one — see useLatest.
  const step = useLatest(opts.step);
  const goToAdjacentWord = useLatest(opts.goToAdjacentWord);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While open, the help modal owns every key: Esc or '?' again both close it, as every other
      // overlay in this app does.
      if (shortcutsOpen) {
        if (e.key === 'Escape' || isShortcut(e, SHORTCUTS.readerHelp)) {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      // The overflow menu owns every key while it is open, as the help modal above does: Escape
      // closes it, and the shortcuts it lists do nothing until it is — otherwise "t" would open the
      // Display panel behind a menu still sitting over it.
      if (menuOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setMenuOpen(false);
        }
        return;
      }
      // While the search overlay is open it owns every key (see its onKeyDown). Bail before the
      // input/textarea check below, since a click on a result row rather than the input would
      // otherwise let these fall through to the reader's shortcuts.
      if (searchOpen) return;
      // Escape is handled before the input/textarea bail below, unlike every other shortcut here:
      // it is the "leave this" key even mid-edit — the highlights panel's note textarea has no
      // Escape handling of its own — rather than a text-insertion key that would land in whatever
      // is focused. A field with graduated Escape behaviour (ListMembershipPicker) calls
      // stopPropagation() so this doesn't fire on the same keypress and skip its first step.
      if (isShortcut(e, SHORTCUTS.readerClose)) {
        // A live selection or highlight-colour popup is the innermost thing to back out of, ahead
        // even of the dictionary dock: a word tap can't happen without first releasing whatever
        // text was selected.
        if (pop) closePop();
        else if (dict) closeDict();
        else if (panel) setPanel(false);
        else closeReader();
        return;
      }
      if (isTypingTarget(e)) return;
      if (isShortcut(e, SHORTCUTS.readerHelp)) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (isShortcut(e, SHORTCUTS.readerSearch)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (isShortcut(e, SHORTCUTS.readerNav)) {
        e.preventDefault();
        step.current(e.key.toLowerCase() === 'j' ? -1 : 1);
      } else if (isShortcut(e, SHORTCUTS.readerDictNav)) {
        // The arrows step the dictionary dock's prev/next word, and do nothing with the dock
        // closed, leaving the browser's own arrow scrolling alone there.
        if (!dict) return;
        e.preventDefault();
        goToAdjacentWord.current(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (isShortcut(e, SHORTCUTS.readerHighlightsToggle)) {
        // Before readerHighlights, which shares this letter and matches with or without Shift.
        e.preventDefault();
        toggleShowHighlights();
      } else if (isShortcut(e, SHORTCUTS.readerHighlights)) {
        e.preventDefault();
        setTab('highlights');
        setPanel(true);
      } else if (isShortcut(e, SHORTCUTS.readerLists)) {
        // Otherwise the same keypress that opens the panel also lands in the Lists tab's
        // now-focused filter input, which autoFocuses (see ListMembershipPicker).
        e.preventDefault();
        setTab('lists');
        setPanel(true);
      } else if (isShortcut(e, SHORTCUTS.readerNote)) {
        e.preventDefault();
        setTab('highlights');
        setPanel(true);
        setNoteFocusSignal((s) => s + 1);
      } else if (isShortcut(e, SHORTCUTS.readerNotesToggle)) {
        e.preventDefault();
        toggleShowNotes();
      } else if (isShortcut(e, SHORTCUTS.readerTheme)) {
        e.preventDefault();
        setTab('text');
        setPanel(true);
      } else if (isShortcut(e, SHORTCUTS.readerThemeCycle)) {
        e.preventDefault();
        cycleTheme();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Only the values this handler branches on. The callbacks it invokes are reached through refs,
    // so neither they nor anything they close over belongs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen, dict, panel, pop, closePop, searchOpen, menuOpen]);
}
