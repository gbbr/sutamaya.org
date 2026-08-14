#!/usr/bin/env node
// Regenerates scripts/update-sujato/snapshot.json from the current data/sujato — i.e. resets the
// baseline update-sujato-check.mjs compares a prospective sc-data checkout against.
//
// MANUAL, DELIBERATE USE ONLY — not part of `npm run update-sujato` (see package.json), and never
// run automatically by check/copy/post. Run it only after `update-sujato:check` has reported
// segment-id changes, you've reviewed them by hand and confirmed they're legitimate upstream
// revisions (not a renamed file or a bad match), and copied them in. Regenerating the snapshot
// without that review defeats its whole purpose: it's what makes the *next* check detect changes,
// not this one.
import fs from 'node:fs';
import path from 'node:path';
import { listLocalRelPaths, keysHash, SUJATO_DIR, SNAPSHOT_PATH, MANIFEST_PATH } from './lib/sujatoSync.js';

// Core logic, callable directly with explicit paths (tests use this to point at a fixture tree
// instead of the real data/sujato — see scripts/update-sujato.test.js).
export function runSnapshot({ sujatoDir = SUJATO_DIR, snapshotPath = SNAPSHOT_PATH, manifestPath = MANIFEST_PATH } = {}) {
  const relPaths = listLocalRelPaths(sujatoDir);
  const files = {};
  for (const relPath of relPaths) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(sujatoDir, relPath), 'utf8')));
    files[relPath] = { keyCount: keys.length, keysHash: keysHash(keys) };
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    note: 'Baseline snapshot of data/sujato, used by update-sujato-check.mjs to verify a prospective sc-data checkout has not renamed files or changed segment ids before copying. Regenerated only manually (npm run update-sujato:snapshot), after reviewing a check failure by hand — never automatically.',
    fileCount: relPaths.length,
    files,
  };

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');

  // Mark manifest.json's provenance as caught up with this snapshot — see
  // scripts/update-sujato-copy.mjs's comment on why sourceCommit/snapshotCommit live together
  // there rather than in snapshot.json.
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.snapshotCommit = manifest.sourceCommit;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  return snapshot;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshot = runSnapshot();
  console.log(`update-sujato snapshot regenerated — ${snapshot.fileCount} files recorded at ${path.relative(process.cwd(), SNAPSHOT_PATH)}.`);
}
