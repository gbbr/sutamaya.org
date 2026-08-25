import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReaderKeyboard } from './useReaderKeyboard';

function setup(overrides: Partial<Parameters<typeof useReaderKeyboard>[0]> = {}) {
  const setShortcutsOpen = vi.fn();
  const setSearchOpen = vi.fn();
  const closePop = vi.fn();
  const closeDict = vi.fn();
  const setPanel = vi.fn();
  const closeReader = vi.fn();
  const step = vi.fn();
  const goToAdjacentWord = vi.fn();
  const setTab = vi.fn();
  const setNoteFocusSignal = vi.fn();
  const toggleShowNotes = vi.fn();
  const cycleTheme = vi.fn();

  const opts: Parameters<typeof useReaderKeyboard>[0] = {
    shortcutsOpen: false,
    setShortcutsOpen,
    searchOpen: false,
    setSearchOpen,
    pop: null,
    closePop,
    dict: null,
    closeDict,
    panel: false,
    setPanel,
    closeReader,
    step,
    siblingIds: ['sn1.1', 'sn1.2'],
    suttaId: 'sn1.1',
    goToAdjacentWord,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
    cycleTheme,
    ...overrides,
  };

  const { rerender, unmount } = renderHook((props) => useReaderKeyboard(props), { initialProps: opts });
  return {
    rerender: (next: Partial<typeof opts>) => rerender({ ...opts, ...next }),
    unmount,
    setShortcutsOpen,
    setSearchOpen,
    closePop,
    closeDict,
    setPanel,
    closeReader,
    step,
    goToAdjacentWord,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
    cycleTheme,
  };
}

function press(key: string, extra: Partial<KeyboardEventInit> = {}, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useReaderKeyboard', () => {
  describe('shortcuts-help modal open', () => {
    it('Escape closes the modal', () => {
      const { setShortcutsOpen } = setup({ shortcutsOpen: true });
      press('Escape');
      expect(setShortcutsOpen).toHaveBeenCalledWith(false);
    });

    it('"?" also closes the modal (toggling it back off)', () => {
      const { setShortcutsOpen } = setup({ shortcutsOpen: true });
      press('?');
      expect(setShortcutsOpen).toHaveBeenCalledWith(false);
    });

    it('every other key is ignored while the modal is open', () => {
      const { setPanel, setTab, step } = setup({ shortcutsOpen: true });
      press('h');
      press('k');
      expect(setPanel).not.toHaveBeenCalled();
      expect(setTab).not.toHaveBeenCalled();
      expect(step).not.toHaveBeenCalled();
    });
  });

  describe('search overlay open', () => {
    it('every reader shortcut is ignored, including Escape', () => {
      const { closeReader, setShortcutsOpen } = setup({ searchOpen: true });
      press('Escape');
      press('?');
      expect(closeReader).not.toHaveBeenCalled();
      expect(setShortcutsOpen).not.toHaveBeenCalled();
    });
  });

  describe('Escape priority chain (readerClose)', () => {
    it('closes a highlight popup first, even with dict/panel also open', () => {
      const { closePop, closeDict, setPanel, closeReader } = setup({ pop: { on: true }, dict: { word: 'x' }, panel: true });
      press('Escape');
      expect(closePop).toHaveBeenCalled();
      expect(closeDict).not.toHaveBeenCalled();
      expect(setPanel).not.toHaveBeenCalled();
      expect(closeReader).not.toHaveBeenCalled();
    });

    it('closes the dictionary dock next, when no popup is open', () => {
      const { closeDict, setPanel, closeReader } = setup({ pop: null, dict: { word: 'x' }, panel: true });
      press('Escape');
      expect(closeDict).toHaveBeenCalled();
      expect(setPanel).not.toHaveBeenCalled();
      expect(closeReader).not.toHaveBeenCalled();
    });

    it('closes the side panel next, when neither popup nor dict is open', () => {
      const { setPanel, closeReader } = setup({ pop: null, dict: null, panel: true });
      press('Escape');
      expect(setPanel).toHaveBeenCalledWith(false);
      expect(closeReader).not.toHaveBeenCalled();
    });

    it('closes the whole reader last, when nothing else is open', () => {
      const { closeReader } = setup({ pop: null, dict: null, panel: false });
      press('Escape');
      expect(closeReader).toHaveBeenCalled();
    });

    it('fires even while an input/textarea has focus, unlike every other shortcut', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const { closeReader } = setup({ pop: null, dict: null, panel: false });
      press('Escape', {}, input);
      expect(closeReader).toHaveBeenCalled();
    });
  });

  describe('input/textarea bail (every shortcut except Escape)', () => {
    it('does not fire "h"/"l"/"n"/"c"/"/" while an input has focus', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const { setPanel, setSearchOpen, toggleShowNotes } = setup();
      press('h', {}, input);
      press('l', {}, input);
      press('/', {}, input);
      press('c', {}, input);
      expect(setPanel).not.toHaveBeenCalled();
      expect(setSearchOpen).not.toHaveBeenCalled();
      expect(toggleShowNotes).not.toHaveBeenCalled();
    });

    it('does not fire while a textarea has focus', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      const { setPanel } = setup();
      press('h', {}, textarea);
      expect(setPanel).not.toHaveBeenCalled();
    });
  });

  describe('individual shortcuts', () => {
    it('"?" opens the shortcuts modal', () => {
      const { setShortcutsOpen } = setup();
      press('?');
      expect(setShortcutsOpen).toHaveBeenCalledWith(true);
    });

    it('"/" opens search', () => {
      const { setSearchOpen } = setup();
      press('/');
      expect(setSearchOpen).toHaveBeenCalledWith(true);
    });

    it('"h" opens the panel on the highlights tab', () => {
      const { setTab, setPanel } = setup();
      press('h');
      expect(setTab).toHaveBeenCalledWith('highlights');
      expect(setPanel).toHaveBeenCalledWith(true);
    });

    it('"l" opens the panel on the lists tab', () => {
      const { setTab, setPanel } = setup();
      press('l');
      expect(setTab).toHaveBeenCalledWith('lists');
      expect(setPanel).toHaveBeenCalledWith(true);
    });

    it('"n" opens the panel on the highlights tab and bumps the note-focus signal', () => {
      const { setTab, setPanel, setNoteFocusSignal } = setup();
      press('n');
      expect(setTab).toHaveBeenCalledWith('highlights');
      expect(setPanel).toHaveBeenCalledWith(true);
      expect(setNoteFocusSignal).toHaveBeenCalled();
      const updater = setNoteFocusSignal.mock.calls[0][0];
      expect(updater(3)).toBe(4);
    });

    it('"c" toggles notes visibility', () => {
      const { toggleShowNotes } = setup();
      press('c');
      expect(toggleShowNotes).toHaveBeenCalled();
    });

    it('ignores a shortcut chorded with Ctrl/Cmd/Alt (e.g. leaves Cmd+/ to the browser)', () => {
      const { setSearchOpen } = setup();
      press('/', { metaKey: true });
      expect(setSearchOpen).not.toHaveBeenCalled();
    });
  });

  describe('readerNav (K/J) vs readerDictNav (Arrow)', () => {
    it('K/J steps to the previous/next sutta', () => {
      const { step } = setup();
      press('k');
      press('j');
      expect(step).toHaveBeenCalledWith(-1);
      expect(step).toHaveBeenCalledWith(1);
    });

    it('plain ArrowLeft/Right walks the dictionary dock word-by-word when it is open', () => {
      const { goToAdjacentWord, step } = setup({ dict: { word: 'x' } });
      press('ArrowLeft');
      press('ArrowRight');
      expect(goToAdjacentWord).toHaveBeenCalledWith(-1);
      expect(goToAdjacentWord).toHaveBeenCalledWith(1);
      expect(step).not.toHaveBeenCalled();
    });

    it('plain Arrow is a no-op — it does not fall back to sutta-to-sutta — when the dock is closed', () => {
      const { goToAdjacentWord, step } = setup({ dict: null });
      press('ArrowLeft');
      expect(goToAdjacentWord).not.toHaveBeenCalled();
      expect(step).not.toHaveBeenCalled();
    });
  });

  describe('readerThemeCycle (Shift+D)', () => {
    it('Shift+D cycles the reader theme', () => {
      const { cycleTheme } = setup();
      press('D', { shiftKey: true });
      expect(cycleTheme).toHaveBeenCalledTimes(1);
    });

    it('plain D does nothing — the Shift is what keeps it off the single-key set', () => {
      const { cycleTheme } = setup();
      press('d');
      expect(cycleTheme).not.toHaveBeenCalled();
    });
  });

  describe('re-subscription cadence', () => {
    it('keeps using the same step()/goToAdjacentWord() closures across renders that only change unrelated state', () => {
      const initialStep = vi.fn();
      const nextStep = vi.fn();
      const { rerender } = setup({ step: initialStep });
      // A render that changes something NOT in the effect's dependency array (e.g. a new `step`
      // function identity from a parent re-render that didn't change siblingIds/suttaId) should
      // not tear down and re-add the listener — mirrors the original inline effect's own
      // dependency array, which deliberately tracked siblingIds/suttaId instead of `step` itself.
      rerender({ step: nextStep });
      press('k');
      expect(initialStep).toHaveBeenCalledWith(-1);
      expect(nextStep).not.toHaveBeenCalled();
    });

    it('picks up a fresh step() once suttaId changes', () => {
      const initialStep = vi.fn();
      const nextStep = vi.fn();
      const { rerender } = setup({ step: initialStep, suttaId: 'sn1.1' });
      rerender({ step: nextStep, suttaId: 'sn1.2' });
      press('k');
      expect(nextStep).toHaveBeenCalledWith(-1);
      expect(initialStep).not.toHaveBeenCalled();
    });
  });

  it('removes its listener on unmount', () => {
    const { unmount, step } = setup();
    unmount();
    press('k');
    expect(step).not.toHaveBeenCalled();
  });
});
