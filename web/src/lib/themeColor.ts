// <meta name="theme-color"> drives OS/browser chrome that CSS can't reach — an installed
// desktop PWA's window title bar, and a mobile browser's status bar. Two independent things want
// to own it: the app shell's own light/dark setting (UiPrefsContext, applied via applyTheme in
// uiPrefs.ts) and, while it's open, the reader's own separately-themed background
// (ReaderPrefsContext applies its palette as an explicit ThemeColors object rather than the
// shell's `dark` class — see that context's own comment on why). The reader's color wins
// whenever it's set (ReaderPage sets it on mount/theme-change, clears it on unmount); clearing it
// falls back to the shell's last-applied color instead of a hardcoded default, so leaving the
// reader restores whatever Library/Settings were already showing.

// Hex twins of index.css's --paper var (#FBF9F5 light, rgb(23 21 19) dark) — duplicated here
// since a meta attribute can't read a CSS custom property directly.
const SHELL_LIGHT = '#FBF9F5';
const SHELL_DARK = '#171513';

let shellColor = SHELL_LIGHT;
let readerColor: string | null = null;

function apply() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', readerColor ?? shellColor);
}

export function setShellThemeColor(dark: boolean) {
  shellColor = dark ? SHELL_DARK : SHELL_LIGHT;
  apply();
}

export function setReaderThemeColor(hex: string | null) {
  readerColor = hex;
  apply();
}
