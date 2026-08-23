import { READER_PANEL_TAB_KEY } from './storageKeys';

export type ReaderPanelTab = 'highlights' | 'lists' | 'text';

const TABS: ReaderPanelTab[] = ['highlights', 'lists', 'text'];

// Which tab the reader's menu panel opens on when nothing asked for a specific one (the header's
// Menu button). Display is the first-run answer — it's the tab with the settings a new reader is
// most likely hunting for — and from then on the panel reopens wherever the reader last was, on
// any sutta, so a per-device preference rather than per-sutta state.
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
