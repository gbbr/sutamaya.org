import { useEffect, useRef, type DependencyList, type RefObject } from 'react';

// Scrolls the element carrying `data-node-id={nodeId}` inside `containerRef` into view the first
// time it is findable after `nodeId` changes; `scrollIntoView({ block: 'nearest' })` is already a
// no-op for a row fully in view. The target row often isn't in the DOM on the render `nodeId`
// changed on, since TreePane's expand-ancestors effects have to run first, so this re-checks on
// every change of `retryOn` until it succeeds once per `nodeId` and then stays quiet.
export function useScrollToNode(containerRef: RefObject<HTMLElement | null>, nodeId: string | undefined, retryOn: DependencyList) {
  const doneForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!nodeId || doneForRef.current === nodeId) return;
    const el = containerRef.current?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    doneForRef.current = nodeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, ...retryOn]);
}
