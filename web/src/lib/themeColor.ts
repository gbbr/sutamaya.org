// `<meta name="theme-color">`, which drives the OS chrome CSS can't reach: a desktop PWA's title
// bar and a mobile browser's status bar. Two things set it, the shell's light/dark theme and the
// reader's own background, and the reader's wins while it is open.

// Hex twins of index.css's --paper, duplicated because a meta attribute can't read a CSS property.
const SHELL_LIGHT = '#FBF9F5';
const SHELL_DARK = '#171513';

let shellColor = SHELL_LIGHT;
let readerColor: string | null = null;

// Writes whichever colour currently wins to the meta tag.
function apply() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', readerColor ?? shellColor);
}

// Sets the shell's colour, which shows whenever the reader has set none.
export function setShellThemeColor(dark: boolean) {
  shellColor = dark ? SHELL_DARK : SHELL_LIGHT;
  apply();
}

// Sets the reader's colour, or clears it with null and hands the chrome back to the shell.
export function setReaderThemeColor(hex: string | null) {
  readerColor = hex;
  apply();
}
