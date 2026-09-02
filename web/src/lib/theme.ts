import type { ReaderFace, ResolvedReaderTheme, ThemeColors } from './types';

// Dark's own highlight fills, index-aligned with HIGHLIGHT_COLORS below; the stored pastels would
// not hold cream body text at 5.2:1 on a brown ground.
const DARK_HIGHLIGHTS = ['#6B4E22', '#4A4A26', '#463A5C'];

export const READER_THEMES: Record<ResolvedReaderTheme, ThemeColors> = {
  // Light's `dim` is a solid warm gray rather than an alpha of `fg`, which would composite to
  // 3.3:1 on this ground, and its `focusTint` is built from `pali` so the wash reads warm. Every
  // `paliTint` is that theme's own `pali` at 15%.
  light: { bg: '#FAF8F3', fg: '#1B1917', dim: '#6B6259', rule: 'rgba(27,25,23,.18)', panel: '#FFFEFB', pali: '#7A5B2E', tint: 'rgba(27,25,23,.1)', paliTint: 'rgba(122,91,46,.15)', focusTint: 'rgba(122,91,46,.09)', highlightPalette: null, selection: '#EADFC6' },
  sepia: { bg: '#F3E7D3', fg: '#3A2E1E', dim: 'rgba(58,46,30,.55)', rule: 'rgba(58,46,30,.2)', panel: '#F8EEDD', pali: '#8C6222', tint: 'rgba(58,46,30,.1)', paliTint: 'rgba(140,98,34,.15)', focusTint: 'rgba(58,46,30,.05)', highlightPalette: null, selection: 'rgba(140,98,34,.32)' },
  // A warm dark brown rather than a near-black, with `fg` held short of a bright cream: at 10.3:1
  // it clears WCAG AAA while keeping 18px type from blooming, which light-on-dark does.
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

// The app shell's palette as a ThemeColors, so a component built for the reader renders unchanged
// in the Library. Every entry is a live `var()` rather than a resolved colour, so it follows
// Settings > Theme without anything here knowing which theme is active. `selection` is unused
// outside the reader and present only to satisfy the type.
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
  // Built from `--accent-text`, as `pali` is, so the wash lightens in dark mode.
  paliTint: 'rgb(var(--accent-text) / .15)',
  focusTint: 'rgb(var(--ink) / .05)',
  highlightPalette: ['rgb(var(--hl-1))', 'rgb(var(--hl-2))', 'rgb(var(--hl-3))'],
  selection: 'rgb(var(--selection))',
};

// The reading faces. Three name a font the OS may not ship, each backed by a self-hosted clone —
// Georgia by Gelasio, Charter by XCharter, Palatino by Gentium Book Plus — so the picker never
// offers a tile that renders as something else. Ordinary font-family fallback does the work, so a
// device with the genuine font downloads none of them.
export const READER_FACES: Record<ReaderFace, string> = {
  georgia: 'Georgia,Gelasio,serif',
  serif: "'Newsreader',Georgia,Gelasio,serif",
  literata: "'Literata',Georgia,Gelasio,serif",
  charter: 'Charter,XCharter,Georgia,Gelasio,serif',
  palatino: "Palatino,'Palatino Linotype','Book Antiqua','Gentium Book Plus',Gelasio,serif",
  sans: "'IBM Plex Sans',system-ui,sans-serif",
};

// The three highlight colours, and the identity a highlight is stored under whatever theme it was
// made in, so changing the theme never rewrites a row. These are also the light and sepia fills;
// DARK_HIGHLIGHTS is dark's rendering of the same three.
export const HIGHLIGHT_COLORS = ['#F0E3A8', '#CBE0C2', '#CFDCEE'];

// The background to paint a stored highlight colour as, substituting the theme's own fill where it
// has one.
export function highlightPaint(color: string, theme: ThemeColors): string {
  const i = HIGHLIGHT_COLORS.indexOf(color);
  return theme.highlightPalette && i >= 0 ? theme.highlightPalette[i] : color;
}
