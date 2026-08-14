#!/usr/bin/env node
// Copies every file update-sujato-check.mjs verified into place, overwriting data/sujato as-is
// (byte-for-byte — no reformatting) with today's sc-data checkout, and records which sc-data
// commit that was in data/sujato/manifest.json. Run update-sujato-check.mjs first; this trusts
// that it passed and fails loudly rather than skipping if a file that used to exist at its
// expected path (see CATEGORY_SOURCE_PREFIXES in lib/sujatoSync.js) somehow doesn't anymore.
// See scripts/update-sujato/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { requireSourceRoot, sourceGitInfo, sourcePathFor, loadSnapshot, SUJATO_DIR, MANIFEST_PATH } from './lib/sujatoSync.js';

let scDataPath, bilaraRoot, gitInfo;
try {
  ({ scDataPath, bilaraRoot } = requireSourceRoot());
  gitInfo = sourceGitInfo(scDataPath);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (gitInfo.dirty) {
  console.warn(`Warning: SC_DATA_PATH (${scDataPath}) has uncommitted local changes — manifest.json's commit won't fully describe what was copied.`);
}

const snapshot = loadSnapshot();

let copied = 0;
for (const relPath of Object.keys(snapshot.files)) {
  const sourcePath = sourcePathFor(bilaraRoot, relPath);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    console.error(`${relPath}: expected source at ${sourcePath ?? '(no known category)'} — run update-sujato-check first.`);
    process.exit(1);
  }
  const destPath = path.join(SUJATO_DIR, relPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
  copied += 1;
}

const manifest = {
  sourceRepo: 'suttacentral/sc-data',
  sourceCommit: gitInfo.commit,
  sourceCommitDate: gitInfo.commitDate,
  sourceDirty: gitInfo.dirty,
  updatedAt: new Date().toISOString(),
  fileCount: copied,
};
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

console.log(`update-sujato copy done — ${copied} files copied from ${bilaraRoot} (sc-data @ ${gitInfo.commit.slice(0, 12)}).`);
