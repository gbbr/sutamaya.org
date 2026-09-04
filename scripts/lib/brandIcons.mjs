// Renders a branded variant of the production icon set: the same mark, desaturated under a colour
// wash, with a band across the foot. One treatment, two sets — see scripts/make-brand-icons.mjs,
// its only caller.
//
// Headless Chrome does the compositing because this machine has no image toolchain; the whole
// treatment is therefore CSS, and the badge colour and band are the two things worth editing.
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TMP = resolve(repoRoot, 'node_modules/.cache/brand-icons');

// source — the production icon to treat, repo-relative; band — whether a badge band runs across the
// foot, which a maskable icon can't carry because a round mask would crop it away.
export const BRAND_ICONS = [
  { out: 'icon-512.png', size: 512, source: 'web/public/icons/icon-512-v2.png', band: true },
  { out: 'icon-512-maskable.png', size: 512, source: 'web/public/icons/icon-512-maskable-v2.png', band: false },
  { out: 'icon-192.png', size: 192, source: 'web/public/icons/icon-192-v2.png', band: true },
  { out: 'apple-touch-icon.png', size: 180, source: 'web/public/icons/apple-touch-icon.png', band: true },
  { out: 'favicon-32.png', size: 32, source: 'web/public/favicon-32-v3.png', band: true },
  { out: 'favicon-16.png', size: 16, source: 'web/public/favicon-16-v3.png', band: true },
];

// Returns the page rendered for one icon: the artwork under a wash, and on top of it the band. The
// band is lettered only above 128px; below that the word is unreadable and the bare stripe reads
// better.
function page({ size, source, band }, colour, label) {
  const bandHeight = Math.round(size * 0.28);
  return `<!doctype html>
<style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; }
  .icon { position: relative; width: ${size}px; height: ${size}px; overflow: hidden; }
  .art {
    width: 100%; height: 100%;
    background: url("file://${resolve(repoRoot, source)}") center / cover no-repeat;
    filter: grayscale(1) contrast(1.05);
  }
  .wash { position: absolute; inset: 0; background: ${colour}; opacity: .34; mix-blend-mode: multiply; }
  .band {
    position: absolute; left: 0; right: 0; bottom: 0; height: ${bandHeight}px;
    background: ${colour}; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font: 700 ${Math.round(bandHeight * 0.52)}px/1 -apple-system, Helvetica, Arial, sans-serif;
    letter-spacing: ${Math.max(0.5, size * 0.008)}px;
  }
</style>
<div class="icon">
  <div class="art"></div>
  <div class="wash"></div>
  ${band ? `<div class="band">${size >= 128 ? label : ''}</div>` : ''}
</div>`;
}

/**
 * Writes one icon from BRAND_ICONS as a PNG at the absolute path `out`, treated in `colour` and
 * lettered `label`. Throws if Chrome isn't there to render it.
 */
export function renderBrandIcon(icon, { colour, label, out }) {
  mkdirSync(TMP, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  const html = resolve(TMP, `${basename(out)}.html`);
  writeFileSync(html, page(icon, colour, label));
  try {
    execFileSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      // Hold the screenshot until the artwork has actually painted. Without it a cold Chrome
      // start can capture the page before the background image decodes, writing a blank icon.
      '--virtual-time-budget=2000',
      `--window-size=${icon.size},${icon.size}`,
      `--screenshot=${out}`,
      `file://${html}`,
    ]);
  } finally {
    rmSync(html, { force: true });
  }
}
