#!/usr/bin/env node
// One-time data acquisition: downloads SuttaCentral's bilara-data `html/pli/ms/sutta/` tree —
// the structural template (per segment id) that says what HTML tag/class each segment renders
// inside on suttacentral.net: `class='verse-line'`/`class='gatha'` for verse vs plain `<p>` for
// prose, `class='speaker'` for a dialogue speaker line, `class='endsutta'`/`endvagga`/`endbook`
// for a closing colophon, `<h2>`/`<h3>` for a sub-heading, etc. Our existing `data/pali/sutta/`
// and `data/sujato/sutta/` are already a mirror of the same upstream repo's `root/pli/ms/sutta/`
// and `translation/en/sujato/sutta/` trees (see data/BRIEF.md) — this fills in the one piece of
// that pipeline we never pulled down, since nothing needed it until now (see CLAUDE.md's
// segment-styling note).
//
// Structural markup is shared across every translation of a root text (a verse is a verse
// regardless of which language you're reading it in), so there's exactly one `html/` file per
// root-text file, at the identical relative path with `_root-pli-ms` swapped for `_html`:
//   data/pali/sutta/sn/sn35/sn35.94_root-pli-ms.json
//   -> html/pli/ms/sutta/sn/sn35/sn35.94_html.json  (upstream)
//   -> data/html/pli/ms/sutta/sn/sn35/sn35.94_html.json  (saved here)
//
// Usage: node scripts/fetch-html-structure.mjs [--concurrency N] [--force]
// Re-running skips files that already exist locally unless --force is passed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PALI_DIR = path.join(ROOT, 'data', 'pali', 'sutta');
const HTML_DIR = path.join(ROOT, 'data', 'html', 'pli', 'ms', 'sutta');
const RAW_BASE = 'https://raw.githubusercontent.com/suttacentral/bilara-data/master/html/pli/ms/sutta';

const args = process.argv.slice(2);
const force = args.includes('--force');
const concurrencyFlagIdx = args.indexOf('--concurrency');
const concurrency = concurrencyFlagIdx !== -1 ? Number(args[concurrencyFlagIdx + 1]) : 16;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('_root-pli-ms.json')) out.push(full);
  }
}

const paliFiles = [];
walk(PALI_DIR, paliFiles);
console.log(`Found ${paliFiles.length} pali root-text files to mirror.`);

const jobs = paliFiles.map((paliPath) => {
  const rel = path.relative(PALI_DIR, paliPath).replace(/_root-pli-ms\.json$/, '_html.json');
  return { url: `${RAW_BASE}/${rel.split(path.sep).join('/')}`, outPath: path.join(HTML_DIR, rel) };
});

let done = 0;
let skipped = 0;
let failed = 0;

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      if (res.status === 404) return null; // no html file upstream for this uid — not fatal
      // 403/429/5xx: back off and retry
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    } catch {
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  return undefined; // exhausted retries
}

async function worker(queue) {
  for (let job = queue.shift(); job; job = queue.shift()) {
    if (!force && fs.existsSync(job.outPath)) {
      skipped += 1;
      continue;
    }
    const text = await fetchWithRetry(job.url);
    if (text === null) {
      failed += 1;
      console.warn(`  no upstream html file: ${job.url}`);
    } else if (text === undefined) {
      failed += 1;
      console.warn(`  failed after retries: ${job.url}`);
    } else {
      fs.mkdirSync(path.dirname(job.outPath), { recursive: true });
      fs.writeFileSync(job.outPath, text);
      done += 1;
    }
    if ((done + skipped + failed) % 250 === 0) {
      console.log(`  ${done + skipped + failed}/${jobs.length} (${done} fetched, ${skipped} skipped, ${failed} failed)`);
    }
  }
}

const queue = [...jobs];
await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));

console.log(`Done: ${done} fetched, ${skipped} already present, ${failed} failed/missing.`);
if (failed > 0) process.exitCode = 1;
