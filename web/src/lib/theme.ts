import type { ReaderFace, ReaderTheme, ThemeColors } from './types';

export const READER_THEMES: Record<ReaderTheme, ThemeColors> = {
  light: { bg: '#FBFAF7', fg: '#1B1917', dim: 'rgba(27,25,23,.5)', rule: 'rgba(27,25,23,.16)', panel: '#FFFDFA', pali: '#8A6A3B' },
  sepia: { bg: '#F3E7D3', fg: '#3A2E1E', dim: 'rgba(58,46,30,.55)', rule: 'rgba(58,46,30,.2)', panel: '#F8EEDD', pali: '#8C6222' },
  dark: { bg: '#191A1C', fg: '#E7E3DC', dim: 'rgba(231,227,220,.5)', rule: 'rgba(231,227,220,.18)', panel: '#212325', pali: '#C9A86F' },
};

export const READER_FACES: Record<ReaderFace, string> = {
  serif: "'Newsreader',Georgia,serif",
  georgia: "Georgia,'Times New Roman',serif",
  sans: "'IBM Plex Sans',system-ui,sans-serif",
};

export const HIGHLIGHT_COLORS = ['#F0E3A8', '#CBE0C2', '#CFDCEE'];
