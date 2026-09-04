import { defineConfig } from 'vitest/config';

// Most of the suite is pure, stable functions (highlight overlap math, list position math,
// corpus tree flattening) — plain Node environment, no DOM needed, so `.test.ts` files (and
// hook-only tests that don't render JSX, e.g. renderHook over a pure derivation) stay on Node
// for speed. `.test.tsx` files render actual components, so those run under jsdom instead —
// scoped via environmentMatchGlobs rather than flipping the whole suite to jsdom.
//
// routeIntent.test.ts, pwaNudge.test.ts, motion.test.ts, entryKind.test.ts, documentMeta.test.ts
// and textSearchClient.test.ts are `.test.ts`
// exceptions: they exercise real Web APIs (sessionStorage/localStorage, matchMedia, the document's
// own head and its visibilitychange event, history and its popstate event) that only exist under
// jsdom (or a browser) — not
// in plain Node (Node's own global Web Storage is a recent, still-stabilizing addition some Node
// versions lack, so relying on it would make the test's pass/fail depend on which Node the
// runner happens to have rather than on the code under test; matchMedia has no Node equivalent
// at all).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['web/src/**/*.test.ts', 'scripts/**/*.test.js'],
          exclude: [
            'web/src/lib/routeIntent.test.ts',
            'web/src/lib/pwaNudge.test.ts',
            'web/src/lib/motion.test.ts',
            'web/src/lib/entryKind.test.ts',
            'web/src/lib/documentMeta.test.ts',
            'web/src/lib/textSearchClient.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'jsdom',
          include: [
            'web/src/**/*.test.tsx',
            'web/src/lib/routeIntent.test.ts',
            'web/src/lib/pwaNudge.test.ts',
            'web/src/lib/motion.test.ts',
            'web/src/lib/entryKind.test.ts',
            'web/src/lib/documentMeta.test.ts',
            'web/src/lib/textSearchClient.test.ts',
          ],
          environment: 'jsdom',
          setupFiles: ['web/src/setupTests.ts'],
        },
      },
      './worker/vitest.config.ts',
    ],
  },
});
