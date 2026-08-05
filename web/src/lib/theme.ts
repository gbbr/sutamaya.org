import type { ReaderFace, ReaderTheme, ThemeColors } from './types';

export const READER_THEMES: Record<ReaderTheme, ThemeColors> = {
  light: { bg: '#FBFAF7', fg: '#1B1917', dim: 'rgba(27,25,23,.5)', rule: 'rgba(27,25,23,.16)', panel: '#FFFDFA', pali: '#8A6A3B' },
  sepia: { bg: '#F3E7D3', fg: '#3A2E1E', dim: 'rgba(58,46,30,.55)', rule: 'rgba(58,46,30,.2)', panel: '#F8EEDD', pali: '#8C6222' },
  // A warm dark brown (like reading by lamplight), not a near-black — matches the rest of the
  // app's warm, literary palette instead of reading as a stark "OLED dark mode" screen.
  dark: { bg: '#2A241E', fg: '#EDE6D9', dim: 'rgba(237,230,217,.5)', rule: 'rgba(237,230,217,.18)', panel: '#332C24', pali: '#C9A86F' },
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
