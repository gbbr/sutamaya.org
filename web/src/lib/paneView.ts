export type PaneView = 'library' | 'lists';

// Pure decision logic behind TreePane's Library/My-lists toggle sync effect — pulled out so it's
// unit-testable on its own, since the mobile pane-state bugs this drives (which pane shows after
// a chip/breadcrumb click, a deep link, or a reader-close round trip) have historically been the
// single most-patched bug class in this component, with no direct test coverage of the decision
// itself.
//
// Returns the pane view to switch to, or null to leave it alone. Null covers: the very first
// mount of a reader-close round trip (its `nodeId` can be a sutta's own corpus node even though
// "My lists" was showing the whole time — forcing back to 'library' would discard that for no
// reason); signed-out users (no lists to switch to); no `nodeId` yet; and a `nodeId` that's
// neither a list id nor a resolvable corpus node (nothing to react to).
export function derivePaneViewSync(params: {
  isFirstRun: boolean;
  restoreOrigin: boolean;
  signedIn: boolean;
  nodeId: string | undefined;
  nodeIsListId: boolean;
  nodeIsCorpusNode: boolean;
}): PaneView | null {
  const { isFirstRun, restoreOrigin, signedIn, nodeId, nodeIsListId, nodeIsCorpusNode } = params;
  if (isFirstRun && restoreOrigin) return null;
  if (!signedIn || !nodeId) return null;
  if (nodeIsListId) return 'lists';
  if (nodeIsCorpusNode) return 'library';
  return null;
}
