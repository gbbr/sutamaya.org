// Renders the staging icon set from the production artwork: the same mark, desaturated under a
// blue wash, with a "STAGING" band across the foot. Run by hand after the production icons change:
//
//   node scripts/make-staging-icons.mjs
//
// Output goes to web/public/icons/staging/ and is committed. Staging serves these instead of the
// production icons — see the manifest and shell rewrites in worker/src/index.js — so a home screen,
// a dock and a browser tab all say at a glance which of the two they are pointing at.
//
// Headless Chrome does the compositing because this machine has no image toolchain; the whole
// treatment is therefore CSS, and the badge colour and band are the two things worth editing.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = resolve(root, 'web/public/icons/staging');
const TMP = resolve(root, 'node_modules/.cache/staging-icons');

// Deliberately outside the app's palette: the point is that it cannot be mistaken for production.
const BADGE = '#1D4ED8';

// source — the production icon to treat; band — whether a badge band runs across the foot, which a
// maskable icon can't carry because a round mask would crop it away. The band is lettered only
// above 128px; below that the word is unreadable and the bare stripe reads better.
const ICONS = [
  { out: 'icon-512.png', size: 512, source: 'web/public/icons/icon-512-v2.png', band: true },
  { out: 'icon-512-maskable.png', size: 512, source: 'web/public/icons/icon-512-maskable-v2.png', band: false },
  { out: 'icon-192.png', size: 192, source: 'web/public/icons/icon-192-v2.png', band: true },
  { out: 'apple-touch-icon.png', size: 180, source: 'web/public/icons/apple-touch-icon.png', band: true },
  { out: 'favicon-32.png', size: 32, source: 'web/public/favicon-32-v3.png', band: true },
  { out: 'favicon-16.png', size: 16, source: 'web/public/favicon-16-v3.png', band: true },
];

// Returns the page rendered for one icon: the artwork under a wash, and on top of it the band.
function page({ size, source, band }) {
  const bandHeight = Math.round(size * 0.28);
  return `<!doctype html>
<style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; }
  .icon { position: relative; width: ${size}px; height: ${size}px; overflow: hidden; }
  .art {
    width: 100%; height: 100%;
    background: url("file://${resolve(root, source)}") center / cover no-repeat;
    filter: grayscale(1) contrast(1.05);
  }
  .wash { position: absolute; inset: 0; background: ${BADGE}; opacity: .34; mix-blend-mode: multiply; }
  .band {
    position: absolute; left: 0; right: 0; bottom: 0; height: ${bandHeight}px;
    background: ${BADGE}; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font: 700 ${Math.round(bandHeight * 0.52)}px/1 -apple-system, Helvetica, Arial, sans-serif;
    letter-spacing: ${Math.max(0.5, size * 0.008)}px;
  }
</style>
<div class="icon">
  <div class="art"></div>
  <div class="wash"></div>
  ${band ? `<div class="band">${size >= 128 ? 'STAGING' : ''}</div>` : ''}
</div>`;
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP, { recursive: true });

for (const icon of ICONS) {
  const html = resolve(TMP, `${icon.out}.html`);
  writeFileSync(html, page(icon));
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${icon.size},${icon.size}`,
    `--screenshot=${resolve(OUT_DIR, icon.out)}`,
    `file://${html}`,
  ]);
  console.log(`  icons/staging/${icon.out}`);
}

rmSync(TMP, { recursive: true, force: true });
