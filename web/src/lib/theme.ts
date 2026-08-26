import type { ReaderFace, ResolvedReaderTheme, ThemeColors } from './types';

// Dark's own highlight fills, index-aligned with HIGHLIGHT_COLORS below. Deeper and more saturated
// than the pastels they stand in for, and pulled toward the theme's own warmth, so the three stay
// tellable apart on a brown ground while cream body text keeps 6:1 or better contrast over them.
const DARK_HIGHLIGHTS = ['#6B4E22', '#4A4A26', '#463A5C'];

export const READER_THEMES: Record<ResolvedReaderTheme, ThemeColors> = {
  // `selection` for light/dark reuses the exact tan the app shell's own `--selection`
  // (index.css) already used for each — the reader's light/dark backgrounds are close enough to
  // the shell's own paper/ink that those hand-tuned colors already looked right unchanged. Sepia
  // has no shell equivalent to borrow, so it's tinted from `pali` (the theme's own warm accent)
  // instead — `fg` would've been a near-neutral choice here, reading as plain gray.
  // `light`'s own `focusTint` is likewise built from `pali` (the same warm brown as the app
  // shell's own `--accent-text`, index.css) rather than `fg`: sepia's and dark's `fg` are already
  // warm-toned (a brown, a cream respectively), so a wash built from *their* `fg` already reads
  // tinted rather than gray — only light's `fg` is a true near-neutral near-black, which made its
  // focus wash read as a flat gray smudge instead of matching the app's warm literary palette.
  // `dim` is a solid warm gray rather than an alpha of `fg`: half of a near-black over a
  // near-white ground composites to 3.3:1, and this theme's `dim` is the color of *every* row
  // label in the menu panel's Display tab and of the tab bar's own inactive labels. It matches
  // the shell's --ink-3 (index.css), which carries the same comment at more length.
  // Each theme's `paliTint` is its own `pali` at 15% — the one alpha that reads as a distinctly
  // warm pill against these backgrounds without becoming a highlight in its own right.
  light: { bg: '#FAF8F3', fg: '#1B1917', dim: '#6B6259', rule: 'rgba(27,25,23,.18)', panel: '#FFFEFB', pali: '#7A5B2E', tint: 'rgba(27,25,23,.1)', paliTint: 'rgba(122,91,46,.15)', focusTint: 'rgba(122,91,46,.09)', highlightPalette: null, selection: '#EADFC6' },
  sepia: { bg: '#F3E7D3', fg: '#3A2E1E', dim: 'rgba(58,46,30,.55)', rule: 'rgba(58,46,30,.2)', panel: '#F8EEDD', pali: '#8C6222', tint: 'rgba(58,46,30,.1)', paliTint: 'rgba(140,98,34,.15)', focusTint: 'rgba(58,46,30,.05)', highlightPalette: null, selection: 'rgba(140,98,34,.32)' },
  // A warm dark brown (like reading by lamplight), not a near-black — matches the rest of the
  // app's warm, literary palette instead of reading as a stark "OLED dark mode" screen.
  dark: {
    bg: '#2A241E',
    fg: '#EDE6D9',
    dim: 'rgba(237,230,217,.5)',
    rule: 'rgba(237,230,217,.18)',
    panel: '#332C24',
    pali: '#C9A86F',
    tint: 'rgba(237,230,217,.09)',
    paliTint: 'rgba(201,168,111,.15)',
    focusTint: 'rgba(237,230,217,.05)',
    highlightPalette: DARK_HIGHLIGHTS,
    selection: '#4A3E28',
  },
};

// The app shell's own palette (index.css's `:root`/`:root.dark`) expressed as a ThemeColors, so a
// component built for the reader can be dropped into the Library unchanged — ListMembershipPicker
// is shared by both. Every entry is a live `var()` reference rather than a resolved colour, so it
// follows Settings > Theme without anything here having to know which theme is active.
// `highlightPalette` points at the shell's own `--hl-*` (index.css): the Library's highlight-count
// badge paints its swatches through highlightPaint like everything in the reader does, so those
// variables are what make a swatch follow the shell's light/dark toggle instead of showing the
// light-mode pastel on a dark Library. `selection` is unused outside the reader and is here only
// to satisfy the type.
export const SHELL_THEME: ThemeColors = {
  bg: 'rgb(var(--paper))',
  fg: 'rgb(var(--ink))',
  dim: 'rgb(var(--ink-4))',
  rule: 'rgb(var(--ink) / .18)',
  panel: 'rgb(var(--field))',
  // `--accent-text`, not `--accent2`: this is the checkbox fill and the input's focus border, both
  // of which sit directly on the page like the Pali subtitles that variable exists for, so it has
  // to lighten in dark mode the way a solid button fill deliberately doesn't.
  pali: 'rgb(var(--accent-text))',
  tint: 'rgb(var(--ink) / .1)',
  // Built from `--accent-text` for the same reason `pali` above is: a wash that sits on the page
  // has to lighten in dark mode, which `--accent` deliberately doesn't.
  paliTint: 'rgb(var(--accent-text) / .15)',
  focusTint: 'rgb(var(--ink) / .05)',
  highlightPalette: ['rgb(var(--hl-1))', 'rgb(var(--hl-2))', 'rgb(var(--hl-3))'],
  selection: 'rgb(var(--selection))',
};

// Three of these name a face the OS may or may not ship, and each is followed by a self-hosted
// clone of it (see index.css) so the picker never offers a tile that renders as something else:
// Georgia falls to Gelasio, Charter to XCharter, Palatino to Gentium Book Plus. Ordinary
// font-family fallback does the work — a browser only reaches for the stand-in when nothing
// before it in the stack can set the character — so an Apple or Windows device uses the genuine
// font and downloads none of them.
export const READER_FACES: Record<ReaderFace, string> = {
  georgia: 'Georgia,Gelasio,serif',
  serif: "'Newsreader',Georgia,Gelasio,serif",
  literata: "'Literata',Georgia,Gelasio,serif",
  charter: 'Charter,XCharter,Georgia,Gelasio,serif',
  palatino: "Palatino,'Palatino Linotype','Book Antiqua','Gentium Book Plus',Gelasio,serif",
  sans: "'IBM Plex Sans',system-ui,sans-serif",
};

// The three highlight colors, and the identity a highlight is stored under: `highlights.c` holds
// one of these hexes whatever theme it was made in, so recoloring a device's theme never rewrites
// a row. They are the light/sepia fills as-is; DARK_HIGHLIGHTS at the top of this file is dark's
// rendering of the same three.
export const HIGHLIGHT_COLORS = ['#F0E3A8', '#CBE0C2', '#CFDCEE'];

// Paints a stored highlight color as an actual background. Light and sepia use the stored pastel
// itself; dark substitutes its own fill for the same index, since no treatment of a pastel works
// on a dark ground — washing it out collapses all three toward the same gray-olive, and leaving it
// opaque makes a bright patch that outshouts the text. Used everywhere a highlight gets painted:
// the inline text span and the color swatches (SegmentedText, HighlightPopup), the highlight-list
// chip (ReaderMenuPanel) and the scroll-edge marks (HighlightGutter) — so a stored color looks the
// same wherever it appears.
export function highlightPaint(color: string, theme: ThemeColors): string {
  const i = HIGHLIGHT_COLORS.indexOf(color);
  return theme.highlightPalette && i >= 0 ? theme.highlightPalette[i] : color;
}
