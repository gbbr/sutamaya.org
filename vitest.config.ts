import { defineConfig } from 'vitest/config';

// Most of the suite is pure, stable functions (highlight overlap math, list position math,
// corpus tree flattening) — plain Node environment, no DOM needed, so `.test.ts` files (and
// hook-only tests that don't render JSX, e.g. renderHook over a pure derivation) stay on Node
// for speed. `.test.tsx` files render actual components, so those run under jsdom instead —
// scoped via environmentMatchGlobs rather than flipping the whole suite to jsdom.
//
// routeIntent.test.ts is a `.test.ts` exception: it exercises `sessionStorage` directly, a real
// Web Storage API that only exists under jsdom (or a browser) — not in plain Node (Node's own
// global sessionStorage is a recent, still-stabilizing addition some Node versions lack, so
// relying on it would make the test's pass/fail depend on which Node the runner happens to have
// rather than on the code under test).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['server/src/**/*.test.js', 'web/src/**/*.test.ts', 'scripts/**/*.test.js'],
          exclude: ['web/src/lib/routeIntent.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'jsdom',
          include: ['web/src/**/*.test.tsx', 'web/src/lib/routeIntent.test.ts'],
          environment: 'jsdom',
          setupFiles: ['web/src/setupTests.ts'],
        },
      },
    ],
  },
});
