import type { ReaderFace, ResolvedReaderTheme, ThemeColors } from './types';

export const READER_THEMES: Record<ResolvedReaderTheme, ThemeColors> = {
  light: { bg: '#FBFAF7', fg: '#1B1917', dim: 'rgba(27,25,23,.5)', rule: 'rgba(27,25,23,.16)', panel: '#FFFDFA', pali: '#8A6A3B', tint: 'rgba(27,25,23,.08)', highlightAlpha: 1 },
  sepia: { bg: '#F3E7D3', fg: '#3A2E1E', dim: 'rgba(58,46,30,.55)', rule: 'rgba(58,46,30,.2)', panel: '#F8EEDD', pali: '#8C6222', tint: 'rgba(58,46,30,.1)', highlightAlpha: 1 },
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
    highlightAlpha: 0.35,
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

export const HIGHLIGHT_COLORS = ['#F0E3A8', '#CBE0C2', '#CFDCEE'];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Paints a stored highlight color (always one of HIGHLIGHT_COLORS above, chosen once via
// HighlightPopup and unaffected by theme) as an actual background — opaque in light/sepia
// (theme.highlightAlpha === 1) and alpha-composited over the dark theme's own background
// otherwise, so the same hue reads as a quiet wash there instead of a bright pastel patch. Used
// everywhere a highlight color gets painted: the inline text span (SegmentedText), the
// highlight-list gutter chip (ReaderMenuPanel), and the scroll-edge gutter marks
// (HighlightGutter) — so all three dim together.
export function highlightPaint(color: string, theme: ThemeColors): string {
  if (theme.highlightAlpha >= 1) return color;
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${theme.highlightAlpha})`;
}
