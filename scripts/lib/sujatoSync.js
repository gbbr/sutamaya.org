// Shared helpers for scripts/update-sujato-{check,copy,post}.mjs — see scripts/update-sujato/README.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');
export const SUJATO_DIR = path.join(ROOT, 'data', 'sujato');
export const SNAPSHOT_PATH = path.join(ROOT, 'scripts', 'update-sujato', 'snapshot.json');
export const MANIFEST_PATH = path.join(SUJATO_DIR, 'manifest.json');

// The Bilara-format subtree of a checked-out suttacentral/sc-data repo — translation/, comment/,
// root/ etc. all live under here; the sibling dirs (html_text/, dictionaries/, relationship/, ...)
// are unrelated to the Sujato English translation this pipeline mirrors.
const BILARA_SUBDIR = 'sc_bilara_data';

// data/sujato/{category}/... -> its upstream sc_bilara_data path prefix, confirmed file-by-file
// against a real sc-data checkout for all 5396 files this pipeline currently tracks (see
// scripts/update-sujato/README.md). Everything after the category segment is the same relative
// path both locally and upstream, e.g. data/sujato/sutta/dn/dn8_translation-en-sujato.json <->
// sc_bilara_data/translation/en/sujato/sutta/dn/dn8_translation-en-sujato.json.
const CATEGORY_SOURCE_PREFIXES = {
  blurb: 'root/en/blurb',
  name: 'translation/en/sujato/name/sutta',
  sutta: 'translation/en/sujato/sutta',
  notes: 'comment/en/sujato/sutta',
};

// Where a data/sujato/{relPath} file lives in the sc-data checkout, or null if relPath doesn't
// start with a known category (see CATEGORY_SOURCE_PREFIXES).
export function sourcePathFor(bilaraRoot, relPath) {
  const [category, ...rest] = relPath.split('/');
  const prefix = CATEGORY_SOURCE_PREFIXES[category];
  if (!prefix) return null;
  return path.join(bilaraRoot, prefix, ...rest);
}

// Diagnostic-only fallback for when a file isn't where CATEGORY_SOURCE_PREFIXES says it should
// be: a full-tree scan for anything else sharing its basename, so a check failure can suggest
// "this might have moved to ..." instead of just "not found". Not used to actually resolve files
// to copy — a basename match found this way hasn't been vetted the way the hardcoded prefixes
// have, so it's a lead for a human to check, not something check/copy should act on automatically.
// Expensive (walks the whole sc_bilara_data tree), so build it lazily and only on an actual miss.
export function buildBasenameIndex(bilaraRoot) {
  const index = new Map();
  for (const file of walkJsonFiles(bilaraRoot)) {
    const bn = path.basename(file);
    if (!index.has(bn)) index.set(bn, []);
    index.get(bn).push(file);
  }
  return index;
}

export function requireSourceRoot() {
  const scDataPath = process.env.SC_DATA_PATH;
  if (!scDataPath) {
    throw new Error(
      'SC_DATA_PATH is not set. Point it at a local checkout of suttacentral/sc-data, e.g.\n' +
        '  SC_DATA_PATH=/path/to/sc-data npm run update-sujato',
    );
  }
  const bilaraRoot = path.join(scDataPath, BILARA_SUBDIR);
  if (!fs.existsSync(bilaraRoot)) {
    throw new Error(`SC_DATA_PATH (${scDataPath}) has no ${BILARA_SUBDIR}/ subdirectory — is it a checkout of suttacentral/sc-data?`);
  }
  return { scDataPath, bilaraRoot };
}

// Which commit of SC_DATA_PATH we're about to copy from, for data/sujato/manifest.json.
export function sourceGitInfo(scDataPath) {
  const git = (...args) => execFileSync('git', ['-C', scDataPath, ...args], { encoding: 'utf8' }).trim();
  let commit, commitDate, dirty;
  try {
    commit = git('rev-parse', 'HEAD');
    commitDate = git('log', '-1', '--format=%cI');
    dirty = git('status', '--porcelain').length > 0;
  } catch (err) {
    throw new Error(`SC_DATA_PATH (${scDataPath}) doesn't look like a git checkout — can't record which sc-data commit was copied (${err.message})`);
  }
  return { commit, commitDate, dirty };
}

export function walkJsonFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.json')) out.push(full);
    }
  }
  return out;
}

// Relative (POSIX-style) paths of every tracked content file currently under sujatoDir (i.e.
// blurb/name/sutta/notes — excludes manifest.json itself, which is provenance metadata, not
// translation content). Defaults to the real data/sujato/; overridable so tests can point it at a
// fixture directory instead.
export function listLocalRelPaths(sujatoDir = SUJATO_DIR) {
  return walkJsonFiles(sujatoDir)
    .map((f) => path.relative(sujatoDir, f).split(path.sep).join('/'))
    .filter((rel) => rel !== path.basename(MANIFEST_PATH))
    .sort();
}

export function keysHash(keys) {
  return crypto.createHash('sha256').update([...keys].sort().join('\n')).digest('hex');
}

// Defaults to the real snapshot.json; overridable so tests can point it at a fixture file instead.
export function loadSnapshot(snapshotPath = SNAPSHOT_PATH) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`No snapshot at ${snapshotPath} — see scripts/update-sujato/README.md.`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
}
