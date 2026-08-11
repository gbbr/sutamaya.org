import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without vitest's `globals: true` (not enabled here — this repo's tests import
// describe/it/expect explicitly), @testing-library/react can't auto-detect a global `afterEach`
// to register its own unmount-between-tests cleanup, so it has to be wired up explicitly here.
afterEach(() => cleanup());

// jsdom doesn't implement scrollIntoView (or layout at all) — components across this app call it
// routinely (search-hit nav, deep-link scroll-to-node, etc.), so stub it globally rather than in
// every test file that happens to render one of them.
Element.prototype.scrollIntoView = function scrollIntoView() {};

// Same reasoning as scrollIntoView above — jsdom implements neither, but the reader's own
// scrollToSegment (useSuttaReading.ts) and its "back to top" button call them directly.
Element.prototype.scrollBy = function scrollBy() {};
Element.prototype.scrollTo = function scrollTo() {};

// jsdom implements no real layout, so Range.prototype has neither getClientRects nor
// getBoundingClientRect at all — useHighlightPopup calls both while building a highlight-popup
// position from a selection, so any selection-driven test throws without these stubs.
Range.prototype.getClientRects = function getClientRects() {
  return [] as unknown as DOMRectList;
};
Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return new DOMRect();
};

// jsdom has no ResizeObserver at all (again, no real layout to observe) — components that
// recompute measurements on resize (e.g. HighlightGutter) need at least a no-op stub to
// construct without throwing; tests that care about a resize firing call the observer callback
// directly instead of relying on this to do anything.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver);
