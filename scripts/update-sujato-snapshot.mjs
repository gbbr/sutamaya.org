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
import { listLocalRelPaths, keysHash, SUJATO_DIR, SNAPSHOT_PATH } from './lib/sujatoSync.js';

const relPaths = listLocalRelPaths();
const files = {};
for (const relPath of relPaths) {
  const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(SUJATO_DIR, relPath), 'utf8')));
  files[relPath] = { keyCount: keys.length, keysHash: keysHash(keys) };
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  note: 'Baseline snapshot of data/sujato, used by update-sujato-check.mjs to verify a prospective sc-data checkout has not renamed files or changed segment ids before copying. Regenerated only manually (npm run update-sujato:snapshot), after reviewing a check failure by hand — never automatically.',
  fileCount: relPaths.length,
  files,
};

fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n');

console.log(`update-sujato snapshot regenerated — ${relPaths.length} files recorded at ${path.relative(process.cwd(), SNAPSHOT_PATH)}.`);
