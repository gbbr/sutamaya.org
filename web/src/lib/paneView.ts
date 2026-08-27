export type PaneView = 'library' | 'lists';

// The decision behind TreePane's Library/My-lists toggle sync effect, kept out of the component so
// it can be unit-tested on its own.
//
// Returns the pane view to switch to, or null to leave it alone. Null covers: the first mount of a
// reader-close round trip, whose `nodeId` can be a sutta's corpus node even though "My lists" was
// showing throughout; the first mount of a return to the node already being browsed (Settings and
// back, a refresh), where `nodeId` expresses no intent to change pane; no `nodeId` yet; and a
// `nodeId` that is neither a list id nor a resolvable corpus node.
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
