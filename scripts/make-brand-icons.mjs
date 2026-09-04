// Renders the two non-production icon sets from the production artwork — the shared treatment in
// scripts/lib/brandIcons.mjs, in blue for staging and green for a dev server. Run by hand after the
// production icons change:
//
//   node scripts/make-brand-icons.mjs
//
// Output goes to web/public/icons/{staging,local}/ and is committed. Staging serves its set in place
// of the production icons (worker/src/index.js) and the dev server serves the local set
// (web/vite.config.ts); a production build references neither.
import { resolve } from 'node:path';

import { BRAND_ICONS, renderBrandIcon, repoRoot } from './lib/brandIcons.mjs';

// The two sets and their badge colours, both outside the app's palette so neither can be mistaken
// for production.
const SETS = [
  { dir: 'staging', colour: '#1D4ED8', label: 'STAGING' },
  { dir: 'local', colour: '#15803D', label: 'LOCAL' },
];

for (const { dir, colour, label } of SETS) {
  for (const icon of BRAND_ICONS) {
    renderBrandIcon(icon, { colour, label, out: resolve(repoRoot, 'web/public/icons', dir, icon.out) });
    console.log(`  icons/${dir}/${icon.out}`);
  }
}
