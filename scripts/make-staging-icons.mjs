// Renders the staging icon set from the production artwork — the shared treatment in
// scripts/lib/brandIcons.mjs, in blue. Run by hand after the production icons change:
//
//   node scripts/make-staging-icons.mjs
//
// Output goes to web/public/icons/staging/ and is committed. Staging serves these instead of the
// production icons — see the manifest and shell rewrites in worker/src/index.js — so a home screen,
// a dock and a browser tab all say at a glance which of the two they are pointing at.
import { resolve } from 'node:path';

import { BRAND_ICONS, renderBrandIcon, repoRoot } from './lib/brandIcons.mjs';

const OUT_DIR = resolve(repoRoot, 'web/public/icons/staging');

// Deliberately outside the app's palette: the point is that it cannot be mistaken for production.
const BADGE = '#1D4ED8';

for (const icon of BRAND_ICONS) {
  renderBrandIcon(icon, { colour: BADGE, label: 'STAGING', out: resolve(OUT_DIR, icon.out) });
  console.log(`  icons/staging/${icon.out}`);
}
