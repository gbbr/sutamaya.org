import { useEffect } from 'react';
import { SHORTCUTS, isShortcut, isTypingTarget } from '../lib/shortcuts';

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
  // Only used below to decide when the listener needs re-subscribing (see the effect's own
  // dependency array comment) — `step` itself closes over these but isn't memoized, so they
  // stand in for it the same way ReaderPage's original inline effect did.
  siblingIds: string[];
  suttaId: string | undefined;
  goToAdjacentWord: (dir: 1 | -1) => void;
  setTab: (tab: 'highlights' | 'lists' | 'text') => void;
  setNoteFocusSignal: (updater: (s: number) => number) => void;
  toggleShowNotes: () => void;
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
    pop,
    closePop,
    dict,
    closeDict,
    panel,
    setPanel,
    closeReader,
    step,
    siblingIds,
    suttaId,
    goToAdjacentWord,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
    cycleTheme,
  } = opts;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While open, the help modal owns every key itself — Esc or '?' again both close it,
      // mirroring how every other overlay in this app closes.
      if (shortcutsOpen) {
        if (e.key === 'Escape' || isShortcut(e, SHORTCUTS.readerHelp)) {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      // While the search overlay is open, it owns every key itself (see its own onKeyDown) —
      // bail out before even the input/textarea tag check below, since a click on a result row
      // (not the input) would otherwise let these fall through to the reader's own shortcuts.
      if (searchOpen) return;
      // Escape is handled before the input/textarea bail below (unlike every other shortcut
      // here) — it's the "leave this" key even mid-edit (e.g. the highlights panel's own note
      // textarea, which has no Escape handling of its own), not a text-insertion key like '/' or
      // 'h'/'l'/'n' that would otherwise land in whatever's focused. A field with its own
      // graduated Escape behavior (see ListMembershipPicker) calls stopPropagation() so this
      // doesn't also fire on the same keypress and skip past its first step.
      if (isShortcut(e, SHORTCUTS.readerClose)) {
        // A live selection/highlight-color popup is the innermost thing to back out of — it
        // takes priority even over the dictionary dock, since a word tap can't happen without
        // first releasing whatever text was selected.
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
        step(e.key.toLowerCase() === 'k' ? -1 : 1);
      } else if (isShortcut(e, SHORTCUTS.readerDictNav)) {
        // The arrows step the dictionary dock's own prev/next word, and do nothing with the dock
        // closed — leaving the browser's own arrow scrolling alone there.
        if (!dict) return;
        e.preventDefault();
        goToAdjacentWord(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (isShortcut(e, SHORTCUTS.readerHighlights)) {
        e.preventDefault();
        setTab('highlights');
        setPanel(true);
      } else if (isShortcut(e, SHORTCUTS.readerLists)) {
        // Without this, the same keypress that opens the panel also lands in the Lists tab's
        // now-focused filter input (it autoFocuses — see ListMembershipPicker) since nothing
        // stopped the browser's own default text-insertion behavior for this key.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen, dict, panel, pop, closePop, searchOpen, siblingIds, suttaId, goToAdjacentWord]);
}
