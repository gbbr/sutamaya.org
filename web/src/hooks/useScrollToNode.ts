import { useEffect, useRef, type DependencyList, type RefObject } from 'react';

// Centres the row carrying `data-node-id={nodeId}` in view, the first time it is findable after
// `nodeId` changes. The row often isn't in the DOM on that render — TreePane's expand-ancestors
// effects run first — so this re-checks on every change of `retryOn` until it succeeds once.
// `settledId` counts as scrolled to already: the node a return to the pane opens on, placed by the
// remembered scroll position, whose row turning up later — its collection opened by hand — is no
// reason to move. A change of `pick` scrolls again, for a node picked while already selected.
export function useScrollToNode(
  containerRef: RefObject<HTMLElement | null>,
  nodeId: string | undefined,
  retryOn: DependencyList,
  settledId?: string,
  pick?: number
) {
  const doneForRef = useRef<string | undefined>(settledId);
  const pickRef = useRef(pick);
  useEffect(() => {
    if (pickRef.current !== pick) {
      pickRef.current = pick;
      doneForRef.current = undefined;
    }
    if (!nodeId || doneForRef.current === nodeId) return;
    const el = containerRef.current?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    doneForRef.current = nodeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, pick, ...retryOn]);
}
