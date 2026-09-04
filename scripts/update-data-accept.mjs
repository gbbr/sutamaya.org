#!/usr/bin/env node
// Accepts the current data/{sujato,pali,html} as the new normal: regenerates
// scripts/update-data/snapshot.json — the baseline update-data-check.mjs compares a prospective
// sc-data checkout against — and, through update-data-counts.mjs, regenerates data/sujato.post/ and
// re-records each term rule's match count.
//
// MANUAL, DELIBERATE USE ONLY — never run automatically by check/copy/post. It is the snapshot the
// *next* check detects changes against, so it is only sound once the current ones have been
// reviewed by hand.
import fs from 'node:fs';
import path from 'node:path';
import { listLocalRelPaths, localPathFor, keysHash, DATA_DIRS, SNAPSHOT_PATH, MANIFEST_PATH, green } from './lib/dataSync.js';
import { SUJATO_DIR, RULES_DIR, RETRANSLATION_PATH, COUNTS_PATH } from './lib/retranslation.js';
import { runCounts, reportCounts } from './update-data-counts.mjs';

// Rewrites the baseline snapshot and returns it, with the counts run's result folded in. Every path
// is a parameter so a test can point it at fixture trees.
export async function runAccept({
  dataDirs = DATA_DIRS,
  snapshotPath = SNAPSHOT_PATH,
  manifestPath = MANIFEST_PATH,
  sujatoDir = dataDirs.sujato ?? SUJATO_DIR,
  postDir = path.join(path.dirname(sujatoDir), 'sujato.post'), // sibling of sujatoDir — SUJATO_POST_DIR for the real repo
  rulesDir = RULES_DIR,
  retranslationPath = RETRANSLATION_PATH,
  countsPath = COUNTS_PATH,
} = {}) {
  const relPaths = listLocalRelPaths(dataDirs);
  const files = {};
  for (const relPath of relPaths) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(localPathFor(relPath, dataDirs), 'utf8')));
    files[relPath] = { keyCount: keys.length, keysHash: keysHash(keys) };
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    note: 'Baseline snapshot of data/{sujato,pali,html}, used by update-data-check.mjs to verify a prospective sc-data checkout has not renamed files or changed segment ids before copying. Regenerated only manually (npm run update-data accept), after reviewing a check failure by hand — never automatically.',
    fileCount: relPaths.length,
    files,
  };

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');

  // Marks manifest.json's provenance as caught up with this snapshot.
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.snapshotCommit = manifest.sourceCommit;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  // Re-runs post against the now-baselined data/sujato and re-records the rule footprints.
  const countsResult = await runCounts({ sujatoDir, postDir, rulesDir, retranslationPath, countsPath });

  return { ...snapshot, ...countsResult };
}
