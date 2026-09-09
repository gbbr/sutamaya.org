import { setNativeStatusBarDark } from './statusBar';

// `<meta name="theme-color">`, which drives the OS chrome CSS can't reach: a desktop PWA's title
// bar and a mobile browser's status bar. Two things set it, the shell's light/dark theme and the
// reader's own background, and the reader's wins while it is open. In a native shell the same
// precedence drives the status bar's text colour (lib/statusBar.ts).

// Hex twins of index.css's --paper, duplicated because a meta attribute can't read a CSS property.
const SHELL_LIGHT = '#FBF9F5';
const SHELL_DARK = '#171513';

let shellColor = SHELL_LIGHT;
let shellDark = false;
let readerColor: string | null = null;
let readerDark = false;

// Writes whichever colour currently wins to the meta tag, and matches the native status bar to it.
function apply() {
  const dark = readerColor !== null ? readerDark : shellDark;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', readerColor ?? shellColor);
  setNativeStatusBarDark(dark);
}

// Sets the shell's colour, which shows whenever the reader has set none.
export function setShellThemeColor(dark: boolean) {
  shellColor = dark ? SHELL_DARK : SHELL_LIGHT;
  shellDark = dark;
  apply();
}

// Sets the reader's colour and whether that background is dark, or clears it with null and hands the
// chrome back to the shell.
export function setReaderThemeColor(hex: string | null, dark = false) {
  readerColor = hex;
  readerDark = dark;
  apply();
}
