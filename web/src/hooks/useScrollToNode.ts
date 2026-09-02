import { useEffect, useRef, type DependencyList, type RefObject } from 'react';

// Scrolls the row carrying `data-node-id={nodeId}` into view, the first time it is findable after
// `nodeId` changes. The row often isn't in the DOM on that render — TreePane's expand-ancestors
// effects run first — so this re-checks on every change of `retryOn` until it succeeds once.
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
