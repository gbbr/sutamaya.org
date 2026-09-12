import { useEffect } from 'react';
import { useLatest } from './useLatest';
import { SHORTCUTS, isShortcut } from '../lib/shortcuts';

interface UseReaderKeyboardOptions {
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  pop: unknown;
  closePop: () => void;
  dict: unknown;
  closeDict: () => void;
  panel: boolean;
  setPanel: (open: boolean) => void;
  closeReader: () => void;
  step: (dir: 1 | -1) => void;
  goToAdjacentWord: (dir: 1 | -1) => void;
  // Whether the put-aside sheet is up, and the way to close it. The topmost thing on the reader,
  // so it is what Escape backs out of first.
  putAsideOpen: boolean;
  closePutAside: () => void;
  // Sets this sutta aside, and opens the nth of the set (1-based). Both no-ops where there is
  // nothing to do — a sutta that already has a tab, a slot the set doesn't fill.
  setAside: () => void;
  openPutAsideSlot: (slot: number) => void;
  setTab: (tab: 'highlights' | 'lists' | 'text') => void;
  setNoteFocusSignal: (updater: (s: number) => number) => void;
  toggleShowNotes: () => void;
  toggleShowHighlights: () => void;
  cycleTheme: () => void;
}

// The reader's single-key shortcuts (lib/shortcuts.ts's SHORTCUTS.reader*), in one window-level
// keydown listener.
//
// The branch order below is load-bearing, and useReaderKeyboard.test.tsx covers it per shortcut.
// An open help modal or search overlay owns every key. Escape backs out of one thing at a time:
// selection popup, dictionary dock, panel, then the reader itself, and is the only one that fires
// mid-edit — isShortcut() stands every other shortcut down while a text field has focus.
export function useReaderKeyboard(opts: UseReaderKeyboardOptions) {
  const {
    shortcutsOpen,
    setShortcutsOpen,
    searchOpen,
    setSearchOpen,
    pop,
    closePop,
    dict,
    closeDict,
    panel,
    setPanel,
    putAsideOpen,
    closePutAside,
    closeReader,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
    toggleShowHighlights,
    cycleTheme,
  } = opts;
  // Read through latest refs, since both are rebuilt on every ReaderPage render while this
  // listener subscribes once.
  const step = useLatest(opts.step);
  const goToAdjacentWord = useLatest(opts.goToAdjacentWord);
  const setAside = useLatest(opts.setAside);
  const openPutAsideSlot = useLatest(opts.openPutAsideSlot);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While the help modal is open it owns every key; Esc and '?' both close it.
      if (shortcutsOpen) {
        if (e.key === 'Escape' || isShortcut(e, SHORTCUTS.readerHelp)) {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      // While the search overlay is open it owns every key (see its onKeyDown).
      if (searchOpen) return;
      // Escape, innermost thing first. A field with graduated Escape behaviour
      // (ListMembershipPicker) calls stopPropagation() so this doesn't skip its first step.
      if (isShortcut(e, SHORTCUTS.readerClose)) {
        if (putAsideOpen) closePutAside();
        else if (pop) closePop();
        else if (dict) closeDict();
        else if (panel) setPanel(false);
        else closeReader();
        return;
      }
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
        // The arrows step the dock's prev/next word, and leave the browser's own arrow scrolling
        // alone while it is closed.
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
        // Prevented, or this keypress also lands in the Lists tab's autoFocused filter input.
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
      } else if (isShortcut(e, SHORTCUTS.readerSetAside)) {
        e.preventDefault();
        setAside.current();
      } else if (isShortcut(e, SHORTCUTS.readerSetAsideSlot)) {
        e.preventDefault();
        openPutAsideSlot.current(Number(e.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Only the values this handler branches on. The callbacks it invokes are reached through refs,
    // so neither they nor anything they close over belongs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen, dict, panel, putAsideOpen, pop, closePop, searchOpen]);
}
