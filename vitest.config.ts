import { defineConfig } from 'vitest/config';

// Most of the suite is pure, stable functions (highlight overlap math, list position math,
// corpus tree flattening) — plain Node environment, no DOM needed, so `.test.ts` files (and
// hook-only tests that don't render JSX, e.g. renderHook over a pure derivation) stay on Node
// for speed. `.test.tsx` files render actual components, so those run under jsdom instead —
// scoped via environmentMatchGlobs rather than flipping the whole suite to jsdom.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['server/src/**/*.test.js', 'web/src/**/*.test.ts', 'scripts/**/*.test.js'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'jsdom',
          include: ['web/src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['web/src/setupTests.ts'],
        },
      },
    ],
  },
});
