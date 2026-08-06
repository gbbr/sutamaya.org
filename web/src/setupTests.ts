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
