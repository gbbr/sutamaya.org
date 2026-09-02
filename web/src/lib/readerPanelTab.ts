import { READER_PANEL_TAB_KEY } from './storageKeys';

export type ReaderPanelTab = 'highlights' | 'lists' | 'text';

const TABS: ReaderPanelTab[] = ['highlights', 'lists', 'text'];

// The tab the reader's menu panel opens on when nothing asks for a specific one: wherever it was
// last left, on any sutta, and Display on a first run. A per-device preference, not per-sutta.
export function getReaderPanelTab(): ReaderPanelTab {
  try {
    const stored = localStorage.getItem(READER_PANEL_TAB_KEY) as ReaderPanelTab | null;
    return stored && TABS.includes(stored) ? stored : 'text';
  } catch {
    return 'text';
  }
}

export function setReaderPanelTab(tab: ReaderPanelTab) {
  try {
    localStorage.setItem(READER_PANEL_TAB_KEY, tab);
  } catch {
    // storage unavailable — the panel just falls back to its default next time
  }
}
