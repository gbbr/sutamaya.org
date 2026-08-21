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
  // `light`'s own `focusTint` is likewise built from `pali` (#8A6A3B — the same warm brown as the
  // app shell's own `--accent2`, index.css) rather than `fg`: sepia's and dark's `fg` are already
  // warm-toned (a brown, a cream respectively), so a wash built from *their* `fg` already reads
  // tinted rather than gray — only light's `fg` is a true near-neutral near-black, which made its
  // focus wash read as a flat gray smudge instead of matching the app's warm literary palette.
  light: { bg: '#FBFAF7', fg: '#1B1917', dim: 'rgba(27,25,23,.5)', rule: 'rgba(27,25,23,.16)', panel: '#FFFDFA', pali: '#8A6A3B', tint: 'rgba(27,25,23,.08)', focusTint: 'rgba(138,106,59,.09)', highlightPalette: null, selection: '#EADFC6' },
  sepia: { bg: '#F3E7D3', fg: '#3A2E1E', dim: 'rgba(58,46,30,.55)', rule: 'rgba(58,46,30,.2)', panel: '#F8EEDD', pali: '#8C6222', tint: 'rgba(58,46,30,.1)', focusTint: 'rgba(58,46,30,.05)', highlightPalette: null, selection: 'rgba(140,98,34,.32)' },
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
    focusTint: 'rgba(237,230,217,.05)',
    highlightPalette: DARK_HIGHLIGHTS,
    selection: '#4A3E28',
  },
};

export const READER_FACES: Record<ReaderFace, string> = {
  serif: "'Newsreader',Georgia,serif",
  georgia: "Georgia,'Times New Roman',serif",
  sans: "'IBM Plex Sans',system-ui,sans-serif",
  // These two round the picker out to 5 without pulling in any new webfont — both are
  // system-installed everywhere, which matters for an offline-first PWA.
  system: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
  times: "'Times New Roman',Times,serif",
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
