import { defineConfig } from 'vitest/config';

// Deliberately minimal: a handful of tests against pure, stable functions (highlight overlap
// math, list position math, highlight grouping, corpus tree flattening) rather than broad
// coverage — see CLAUDE.md. Plain Node environment is enough; nothing here touches the DOM.
export default defineConfig({
  test: {
    include: ['server/src/**/*.test.js', 'web/src/**/*.test.ts', 'scripts/**/*.test.js'],
  },
});
