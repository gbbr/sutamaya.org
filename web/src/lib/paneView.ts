export type PaneView = 'library' | 'lists';

// Pure decision logic behind TreePane's Library/My-lists toggle sync effect — kept out of the
// component so the decision itself is unit-testable, since which pane shows after a chip or
// breadcrumb click, a deep link, or a reader-close round trip is delicate and easy to regress.
//
// Returns the pane view to switch to, or null to leave it alone. Null covers: the very first
// mount of a reader-close round trip (its `nodeId` can be a sutta's own corpus node even though
// "My lists" was showing the whole time — forcing back to 'library' would discard that for no
// reason); no `nodeId` yet; and a `nodeId` that's neither a list id nor a resolvable corpus node
// (nothing to react to).
export function derivePaneViewSync(params: {
  isFirstRun: boolean;
  restoreOrigin: boolean;
  nodeId: string | undefined;
  nodeIsListId: boolean;
  nodeIsCorpusNode: boolean;
}): PaneView | null {
  const { isFirstRun, restoreOrigin, nodeId, nodeIsListId, nodeIsCorpusNode } = params;
  if (isFirstRun && restoreOrigin) return null;
  if (!nodeId) return null;
  if (nodeIsListId) return 'lists';
  if (nodeIsCorpusNode) return 'library';
  return null;
}
