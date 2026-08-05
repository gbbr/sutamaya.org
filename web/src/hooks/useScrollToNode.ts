import { useEffect, useRef, type DependencyList, type RefObject } from 'react';

// Scrolls the element carrying `data-node-id={nodeId}` inside `containerRef` into view the
// first time it's findable after `nodeId` changes (`scrollIntoView({ block: 'nearest' })` is
// already a no-op if it's already fully visible). The target row often doesn't exist in the DOM
// yet on the very same render `nodeId` changed on — an "expand ancestors" effect elsewhere
// (TreePane's `expanded`/`listExpanded` state) still needs to run and re-render first — so this
// re-checks on every one of `retryOn`'s changes until it succeeds once per `nodeId`, then stays
// quiet (it won't re-scroll just because the caller's retry deps changed for some unrelated
// reason, e.g. the user manually toggling an unrelated branch).
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
