// Renders the two non-production icon sets from the production artwork — the shared treatment in
// scripts/lib/brandIcons.mjs, in blue for staging and green for a dev server. Run by hand after the
// production icons change:
//
//   node scripts/make-brand-icons.mjs
//
// Output goes to web/public/icons/{staging,local}/ and is committed. Staging serves its set instead
// of the production icons (see the manifest and shell rewrites in worker/src/index.js) and the dev
// server serves the local set (web/vite.config.ts), so a home screen, a dock and a browser tab all
// say at a glance which of the three they are pointing at. Neither set is referenced by a
// production build, so no deployed reader ever fetches one.
import { resolve } from 'node:path';

import { BRAND_ICONS, renderBrandIcon, repoRoot } from './lib/brandIcons.mjs';

// Deliberately outside the app's palette: the point is that neither can be mistaken for production.
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
