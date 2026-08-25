export type PaneView = 'library' | 'lists';

// Pure decision logic behind TreePane's Library/My-lists toggle sync effect — kept out of the
// component so the decision itself is unit-testable, since which pane shows after a chip or
// breadcrumb click, a deep link, or a reader-close round trip is delicate and easy to regress.
//
// Returns the pane view to switch to, or null to leave it alone. Null covers: the very first
// mount of a reader-close round trip (its `nodeId` can be a sutta's own corpus node even though
// "My lists" was showing the whole time — forcing back to 'library' would discard that for no
// reason); the first mount of a return to the node already being browsed (Settings and back,
// a refresh — same reason: flipping the toggle doesn't change `nodeId`, so syncing would
// discard a "My lists" that was showing when the user left); no `nodeId` yet; and a `nodeId`
// that's neither a list id nor a resolvable corpus node (nothing to react to).
export function derivePaneViewSync(params: {
  isFirstRun: boolean;
  restoreOrigin: boolean;
  // This mount arrived at the same node the pane was last left on, so it's a return rather
  // than a navigation — nothing about `nodeId` expresses an intent to change pane.
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
