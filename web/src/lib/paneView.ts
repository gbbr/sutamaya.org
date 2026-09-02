export type PaneView = 'library' | 'lists';

// Which pane TreePane's Library/My lists toggle should switch to, or null to leave it alone —
// which covers a return where `nodeId` expresses no intent to change pane, no `nodeId` at all, and
// one that names neither a list nor a corpus node. Kept out of the component so it is unit-testable.
export function derivePaneViewSync(params: {
  isFirstRun: boolean;
  restoreOrigin: boolean;
  // Arrived at the node the pane was last left on — a return, not a navigation.
  returningToSameNode: boolean;
  nodeId: string | undefined;
  nodeIsListId: boolean;
  nodeIsCorpusNode: boolean;
}): PaneView | null {
  const { isFirstRun, restoreOrigin, returningToSameNode, nodeId, nodeIsListId, nodeIsCorpusNode } = params;
  if (isFirstRun && (restoreOrigin || returningToSameNode)) return null;
  if (!nodeId) return null;
  if (nodeIsListId) return 'lists';
  if (nodeIsCorpusNode) return 'library';
  return null;
}
