import { useEffect, useRef, type DependencyList, type RefObject } from 'react';

// Scrolls the row carrying `data-node-id={nodeId}` into view, the first time it is findable after
// `nodeId` changes. The row often isn't in the DOM on that render — TreePane's expand-ancestors
// effects run first — so this re-checks on every change of `retryOn` until it succeeds once.
// `settledId` counts as scrolled to already: the node a return to the pane opens on, placed by the
// remembered scroll position, whose row turning up later — its collection opened by hand — is no
// reason to move.
export function useScrollToNode(containerRef: RefObject<HTMLElement | null>, nodeId: string | undefined, retryOn: DependencyList, settledId?: string) {
  const doneForRef = useRef<string | undefined>(settledId);
  useEffect(() => {
    if (!nodeId || doneForRef.current === nodeId) return;
    const el = containerRef.current?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    doneForRef.current = nodeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, ...retryOn]);
}
