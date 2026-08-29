import type { ReaderFace, ResolvedReaderTheme, ThemeColors } from './types';

// Dark's own highlight fills, index-aligned with HIGHLIGHT_COLORS below. Deeper and warmer than the
// pastels they stand in for, so the three stay tellable apart on a brown ground while cream body
// text keeps 5.2:1 or better contrast over them.
const DARK_HIGHLIGHTS = ['#6B4E22', '#4A4A26', '#463A5C'];

export const READER_THEMES: Record<ResolvedReaderTheme, ThemeColors> = {
  // `selection` for light and dark reuses the app shell's own `--selection` (index.css); sepia has
  // no shell equivalent and is tinted from `pali` instead. Light's `focusTint` is built from `pali`
  // too, so the wash reads warm rather than as a flat gray smudge — sepia's and dark's `fg` are
  // already warm-toned, light's is a near-neutral near-black. `dim` is a solid warm gray, not an
  // alpha of `fg`: half of a near-black over a near-white ground composites to 3.3:1, and `dim` is
  // the color of every row label in the menu panel's Display tab and of the tab bar's inactive
  // labels. Each `paliTint` is that theme's own `pali` at 15%.
  light: { bg: '#FAF8F3', fg: '#1B1917', dim: '#6B6259', rule: 'rgba(27,25,23,.18)', panel: '#FFFEFB', pali: '#7A5B2E', tint: 'rgba(27,25,23,.1)', paliTint: 'rgba(122,91,46,.15)', focusTint: 'rgba(122,91,46,.09)', highlightPalette: null, selection: '#EADFC6' },
  sepia: { bg: '#F3E7D3', fg: '#3A2E1E', dim: 'rgba(58,46,30,.55)', rule: 'rgba(58,46,30,.2)', panel: '#F8EEDD', pali: '#8C6222', tint: 'rgba(58,46,30,.1)', paliTint: 'rgba(140,98,34,.15)', focusTint: 'rgba(58,46,30,.05)', highlightPalette: null, selection: 'rgba(140,98,34,.32)' },
  // A warm dark brown, like reading by lamplight, rather than a near-black. `fg` is deliberately
  // held short of a bright cream: light-on-dark type haloes at small sizes, so the body text sits
  // at 10.3:1 rather than the 12.4:1 a brighter cream would give — comfortably past WCAG AAA's 7:1
  // while keeping 18px from blooming.
  dark: {
    bg: '#2A241E',
    fg: '#DCD3C3',
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

// The app shell's palette (index.css's `:root`/`:root.dark`) expressed as a ThemeColors, so a
// component built for the reader can be dropped into the Library unchanged — ListMembershipPicker
// is shared by both. Every entry is a live `var()` reference rather than a resolved colour, so it
// follows Settings > Theme without anything here knowing which theme is active. `highlightPalette`
// points at the shell's `--hl-*`, which is what makes the Library's highlight-count swatches follow
// the light/dark toggle. `selection` is unused outside the reader and is here to satisfy the type.
export const SHELL_THEME: ThemeColors = {
  bg: 'rgb(var(--paper))',
  fg: 'rgb(var(--ink))',
  dim: 'rgb(var(--ink-4))',
  rule: 'rgb(var(--ink) / .18)',
  panel: 'rgb(var(--field))',
  // `--accent-text`, not `--accent2`: this is the checkbox fill and the input's focus border, both
  // sitting directly on the page, so they have to lighten in dark mode the way a solid button fill
  // deliberately doesn't.
  pali: 'rgb(var(--accent-text))',
  tint: 'rgb(var(--ink) / .1)',
  // Built from `--accent-text` for the same reason as `pali`: a wash on the page has to lighten in
  // dark mode.
  paliTint: 'rgb(var(--accent-text) / .15)',
  focusTint: 'rgb(var(--ink) / .05)',
  highlightPalette: ['rgb(var(--hl-1))', 'rgb(var(--hl-2))', 'rgb(var(--hl-3))'],
  selection: 'rgb(var(--selection))',
};

// Three of these name a face the OS may or may not ship, each followed by a self-hosted clone (see
// index.css) so the picker never offers a tile that renders as something else: Georgia falls to
// Gelasio, Charter to XCharter, Palatino to Gentium Book Plus. Ordinary font-family fallback does
// the work, so a device that has the genuine font downloads none of them.
export const READER_FACES: Record<ReaderFace, string> = {
  georgia: 'Georgia,Gelasio,serif',
  serif: "'Newsreader',Georgia,Gelasio,serif",
  literata: "'Literata',Georgia,Gelasio,serif",
  charter: 'Charter,XCharter,Georgia,Gelasio,serif',
  palatino: "Palatino,'Palatino Linotype','Book Antiqua','Gentium Book Plus',Gelasio,serif",
  sans: "'IBM Plex Sans',system-ui,sans-serif",
};

// The three highlight colors, and the identity a highlight is stored under: `highlights.c` holds
// one of these hexes whatever theme it was made in, so changing a device's theme never rewrites a
// row. These are the light/sepia fills; DARK_HIGHLIGHTS at the top of this file is dark's rendering
// of the same three.
export const HIGHLIGHT_COLORS = ['#F0E3A8', '#CBE0C2', '#CFDCEE'];

// Paints a stored highlight color as an actual background: light and sepia use the stored pastel,
// dark substitutes its own fill for the same index. Used everywhere a highlight is painted — the
// inline text span and the color swatches (SegmentedText, HighlightPopup), the highlight-list chip
// (ReaderMenuPanel) and the scroll-edge marks (HighlightGutter).
export function highlightPaint(color: string, theme: ThemeColors): string {
  const i = HIGHLIGHT_COLORS.indexOf(color);
  return theme.highlightPalette && i >= 0 ? theme.highlightPalette[i] : color;
}
