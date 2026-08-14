#!/usr/bin/env node
// Verifies a checked-out sc-data repo (SC_DATA_PATH) is safe to copy from before
// update-sujato-copy.mjs overwrites data/sujato with it: every file we currently track must
// still exist at its expected path (see CATEGORY_SOURCE_PREFIXES in lib/sujatoSync.js), with the
// exact same set of segment ids it had when scripts/update-sujato/snapshot.json was taken — only
// the translated values are allowed to differ. See scripts/update-sujato/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { requireSourceRoot, sourcePathFor, buildBasenameIndex, loadSnapshot, keysHash, SUJATO_DIR } from './lib/sujatoSync.js';

function describeSetDiff(oldKeys, newKeys) {
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);
  const removed = oldKeys.filter((k) => !newSet.has(k));
  const added = newKeys.filter((k) => !oldSet.has(k));
  const MAX = 10;
  const fmt = (arr) => arr.slice(0, MAX).join(', ') + (arr.length > MAX ? `, … (${arr.length} total)` : '');
  const parts = [];
  if (removed.length) parts.push(`missing segment ids: ${fmt(removed)}`);
  if (added.length) parts.push(`new segment ids: ${fmt(added)}`);
  return parts.join('; ');
}

let bilaraRoot;
try {
  ({ bilaraRoot } = requireSourceRoot());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const snapshot = loadSnapshot();

// Built lazily on the first missing file — a full-tree scan, so not worth doing unless something
// has actually gone missing from its expected path.
let basenameIndex = null;
function possibleRelocations(relPath) {
  if (!basenameIndex) basenameIndex = buildBasenameIndex(bilaraRoot);
  return basenameIndex.get(path.basename(relPath)) || [];
}

const issues = [];
let checked = 0;

for (const [relPath, expected] of Object.entries(snapshot.files)) {
  const sourcePath = sourcePathFor(bilaraRoot, relPath);

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const where = sourcePath ?? '(no known category)';
    const relocations = possibleRelocations(relPath);
    const hint = relocations.length > 0 ? ` — might have moved to: ${relocations.join(', ')}` : '';
    issues.push(`${relPath}: expected at ${where}, not found${hint} (renamed or removed upstream?)`);
    continue;
  }

  let keys;
  try {
    keys = Object.keys(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  } catch (err) {
    issues.push(`${relPath}: failed to parse ${sourcePath}: ${err.message}`);
    continue;
  }

  if (keys.length !== expected.keyCount || keysHash(keys) !== expected.keysHash) {
    const oldKeys = Object.keys(JSON.parse(fs.readFileSync(path.join(SUJATO_DIR, relPath), 'utf8')));
    issues.push(`${relPath}: segment ids changed (${oldKeys.length} → ${keys.length}) — ${describeSetDiff(oldKeys, keys)}`);
    continue;
  }

  checked += 1;
}

if (issues.length > 0) {
  console.error(`update-sujato check FAILED — ${issues.length} of ${Object.keys(snapshot.files).length} tracked file(s) have a problem:\n`);
  for (const issue of issues) console.error(`- ${issue}`);
  console.error(
    `\nReview the files, copy them over using upadte-sujato:copy, test the post using update-sujato:post ` +
      `and if all looks well regenerate the snapshot using update-sujato:snapshot.`,
  );
  process.exit(1);
}

console.log(`update-sujato check OK — ${checked} tracked files verified against ${bilaraRoot}.`);
