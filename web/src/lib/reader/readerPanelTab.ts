export type ReaderPanelTab = 'highlights' | 'lists' | 'text';

// The tab the reader's menu panel opens on when nothing asks for a specific one.
// Always defaults to 'text' (Style) tab.
export function getReaderPanelTab(): ReaderPanelTab {
  return 'text';
}

export function setReaderPanelTab(tab: ReaderPanelTab) {
  // No-op: the menu now always opens to the 'text' tab.
}
