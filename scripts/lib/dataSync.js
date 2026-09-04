// Shared helpers for the update-data pipeline — see data/README.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The pipeline's CLI colors, as raw ANSI codes. Dropped entirely when neither stdout nor stderr is
// a TTY, or NO_COLOR is set.
const useColor = (!!process.stdout.isTTY || !!process.stderr.isTTY) && !process.env.NO_COLOR;
const wrapColor = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = wrapColor(91); // bright red — plain 31 reads too dark on a black background
export const green = wrapColor(32);
export const yellow = wrapColor(33);
export const blue = wrapColor(36);
export const bold = wrapColor(1);
export const dim = wrapColor(2);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');
export const DATA_ROOT = path.join(ROOT, 'data');
export const SUJATO_DIR = path.join(DATA_ROOT, 'sujato');
export const PALI_DIR = path.join(DATA_ROOT, 'pali');
export const HTML_DIR = path.join(DATA_ROOT, 'html');
export const SNAPSHOT_PATH = path.join(ROOT, 'scripts', 'update-data', 'snapshot.json');
// Provenance for all three dirs below, which one sc-data checkout fills in one run. A sibling of
// all three rather than nested under any.
export const MANIFEST_PATH = path.join(DATA_ROOT, 'manifest.json');

// The three local dirs kept in sync with sc-data, keyed by the first segment of every relPath
// below ('sujato/sutta/…', 'pali/name/…', 'html/pli/ms/sutta/…').
export const DATA_DIRS = {
  sujato: SUJATO_DIR,
  pali: PALI_DIR,
  html: HTML_DIR,
};

// The Bilara-format subtree of an sc-data checkout, holding translation/, comment/, root/ and
// html/; its sibling dirs mirror nothing here.
const BILARA_SUBDIR = 'sc_bilara_data';

// {dataDir}/{category}/… -> its upstream sc_bilara_data path prefix. Everything after the matched
// prefix is the same relative path on both sides, e.g.
// data/sujato/sutta/dn/dn8_translation-en-sujato.json <->
// sc_bilara_data/translation/en/sujato/sutta/dn/dn8_translation-en-sujato.json.
const CATEGORY_SOURCE_PREFIXES = {
  'sujato/blurb': 'root/en/blurb',
  'sujato/name': 'translation/en/sujato/name/sutta',
  'sujato/sutta': 'translation/en/sujato/sutta',
  'sujato/notes': 'comment/en/sujato/sutta',
  'pali/sutta': 'root/pli/ms/sutta',
  'pali/name': 'root/misc/site/name/sutta',
  html: 'html',
};

// Longest prefix first, so the most specific category matches.
const SORTED_PREFIXES = Object.entries(CATEGORY_SOURCE_PREFIXES).sort((a, b) => b[0].length - a[0].length);

// Returns where `relPath` lives in the sc-data checkout, or null if it names no known category.
export function sourcePathFor(bilaraRoot, relPath) {
  const parts = relPath.split('/');
  for (const [prefix, source] of SORTED_PREFIXES) {
    const prefixParts = prefix.split('/');
    if (prefixParts.every((p, i) => parts[i] === p)) {
      return path.join(bilaraRoot, source, ...parts.slice(prefixParts.length));
    }
  }
  return null;
}

// Returns `relPath`'s absolute local path, resolved through its first segment ('sujato' | 'pali' |
// 'html'). `dataDirs` is a parameter so a test can point it at fixture dirs.
export function localPathFor(relPath, dataDirs = DATA_DIRS) {
  const [dirName, ...rest] = relPath.split('/');
  const base = dataDirs[dirName];
  if (!base) throw new Error(`${relPath}: unrecognized data dir (expected one of ${Object.keys(dataDirs).join(', ')}).`);
  return path.join(base, ...rest);
}

// Returns basename -> every upstream file with that name, for suggesting where a missing file
// might have moved to. Diagnostic only: a basename match is a lead for a human, never a path to
// copy from. Walks the whole tree, so build it only on a miss.
export function buildBasenameIndex(bilaraRoot) {
  const index = new Map();
  for (const file of walkJsonFiles(bilaraRoot)) {
    const bn = path.basename(file);
    if (!index.has(bn)) index.set(bn, []);
    index.get(bn).push(file);
  }
  return index;
}

// Returns the sc-data checkout named by SC_DATA_PATH and its Bilara subtree, or throws saying how
// to set it.
export function requireSourceRoot() {
  const scDataPath = process.env.SC_DATA_PATH;
  if (!scDataPath) {
    throw new Error(
      'SC_DATA_PATH is not set. Point it at a local checkout of suttacentral/sc-data, e.g.\n' +
        '  SC_DATA_PATH=/path/to/sc-data npm run update-data',
    );
  }
  const bilaraRoot = path.join(scDataPath, BILARA_SUBDIR);
  if (!fs.existsSync(bilaraRoot)) {
    throw new Error(`SC_DATA_PATH (${scDataPath}) has no ${BILARA_SUBDIR}/ subdirectory — is it a checkout of suttacentral/sc-data?`);
  }
  return { scDataPath, bilaraRoot };
}

// Returns the commit, its date and whether the tree is dirty, for data/manifest.json.
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

// Returns the sorted relPath of every tracked file under `dataDirs`, each prefixed with its dir
// name — the form sourcePathFor and localPathFor key off.
export function listLocalRelPaths(dataDirs = DATA_DIRS) {
  const out = [];
  for (const [dirName, dirPath] of Object.entries(dataDirs)) {
    for (const file of walkJsonFiles(dirPath)) {
      out.push([dirName, path.relative(dirPath, file).split(path.sep).join('/')].join('/'));
    }
  }
  return out.sort();
}

export function keysHash(keys) {
  return crypto.createHash('sha256').update([...keys].sort().join('\n')).digest('hex');
}

// Returns a file's segment ids, or null when it is missing or unparseable — the "unreadable"
// answer checkCrossCategoryIntegrity's keysFor callback expects.
export function readKeysSafe(filePath) {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

// Reads the baseline snapshot. The path is a parameter so a test can point it at a fixture.
export function loadSnapshot(snapshotPath = SNAPSHOT_PATH) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`No snapshot at ${snapshotPath} — see data/README.md.`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
}

// Verifies data/{sujato,pali,html} still matches snapshot.json. Needs no sc-data checkout, so
// `npm test` runs it: post-processing only changes values, never segment ids, so a tracked file's
// keys should always still be the ones the snapshot recorded.
export function checkSnapshotInSync({ dataDirs = DATA_DIRS, snapshotPath = SNAPSHOT_PATH } = {}) {
  const snapshot = loadSnapshot(snapshotPath);
  const issues = [];

  for (const [relPath, expected] of Object.entries(snapshot.files)) {
    const localPath = localPathFor(relPath, dataDirs);
    if (!fs.existsSync(localPath)) {
      issues.push(`${relPath}: tracked in snapshot.json but missing locally entirely.`);
      continue;
    }
    const keys = Object.keys(JSON.parse(fs.readFileSync(localPath, 'utf8')));
    if (keys.length !== expected.keyCount || keysHash(keys) !== expected.keysHash) {
      // Just what differs; the caller says once per run what to do about it.
      issues.push(`${relPath}: local keys differ from the snapshot (${expected.keyCount} → ${keys.length}).`);
    }
  }

  return { ok: issues.length === 0, issues };
}

// The segment-id relationships that must hold between two categories describing the same document.
// A file's `prefix` and `suffix` are stripped to leave the base key both sides share, so
// 'pali/sutta/an/an1/an1.1-10_root-pli-ms.json' and 'html/pli/ms/sutta/an/an1/an1.1-10_html.json'
// both reduce to 'an/an1/an1.1-10'. Only the sutta body text is checked: blurb and notes have no
// Pali counterpart, and the name-index files don't reliably align.
export const INTEGRITY_GROUPS = [
  {
    // Pali root text and its HTML structural mirror render the same segments, so their ids must
    // match exactly, both ways.
    name: 'sutta text: pali vs html',
    kind: 'exact',
    a: { prefix: 'pali/sutta', suffix: '_root-pli-ms.json' },
    b: { prefix: 'html/pli/ms/sutta', suffix: '_html.json' },
  },
  {
    // The translation skips some Pali-only scribal colophon lines, so this holds one way only:
    // every id sujato has must exist in pali. A translated segment with no Pali counterpart would
    // have no interlinear Pali and no role tagging.
    name: 'sutta text: sujato vs pali',
    kind: 'subset', // every id in `a` must exist in `b`
    a: { prefix: 'sujato/sutta', suffix: '_translation-en-sujato.json' },
    b: { prefix: 'pali/sutta', suffix: '_root-pli-ms.json' },
  },
];

function baseKeyFor({ prefix, suffix }, relPath) {
  if (!relPath.startsWith(`${prefix}/`) || !relPath.endsWith(suffix)) return null;
  return relPath.slice(prefix.length + 1, -suffix.length);
}

const previewList = (arr, max = 5) => arr.slice(0, max).join(', ') + (arr.length > max ? `, … (${arr.length} total)` : '');

// Cross-checks every INTEGRITY_GROUPS group over `relPaths` and returns a flat list of issues.
// `keysFor(relPath)` reads each file's segment ids, so the caller decides whether the check runs
// against the upstream checkout or the local tree.
export function checkCrossCategoryIntegrity(relPaths, keysFor) {
  const issues = [];

  for (const group of INTEGRITY_GROUPS) {
    const byBaseKeyA = new Map();
    const byBaseKeyB = new Map();
    for (const relPath of relPaths) {
      const ka = baseKeyFor(group.a, relPath);
      if (ka !== null) byBaseKeyA.set(ka, relPath);
      const kb = baseKeyFor(group.b, relPath);
      if (kb !== null) byBaseKeyB.set(kb, relPath);
    }

    const allBaseKeys = new Set([...byBaseKeyA.keys(), ...byBaseKeyB.keys()]);
    for (const baseKey of [...allBaseKeys].sort()) {
      const relA = byBaseKeyA.get(baseKey);
      const relB = byBaseKeyB.get(baseKey);

      if (!relA || !relB) {
        // An 'exact' group wants both sides present; a 'subset' group only flags a subset-side
        // file with no counterpart — a Pali range with no translation at all is ordinary.
        if (group.kind === 'exact' || (group.kind === 'subset' && relA)) {
          issues.push(`${group.name} ${baseKey}: present in ${relA ? group.a.prefix : group.b.prefix} but missing from ${relA ? group.b.prefix : group.a.prefix}.`);
        }
        continue;
      }

      const keysA = keysFor(relA);
      const keysB = keysFor(relB);
      if (keysA === null || keysB === null) continue; // unreadable — already reported elsewhere

      const setA = new Set(keysA);
      const setB = new Set(keysB);
      const onlyInA = [...setA].filter((k) => !setB.has(k));

      if (group.kind === 'exact') {
        const onlyInB = [...setB].filter((k) => !setA.has(k));
        if (!onlyInA.length && !onlyInB.length) continue;
        const parts = [];
        if (onlyInA.length) parts.push(`only in ${group.a.prefix}: ${previewList(onlyInA)}`);
        if (onlyInB.length) parts.push(`only in ${group.b.prefix}: ${previewList(onlyInB)}`);
        issues.push(`${group.name} ${baseKey}: segment ids differ — ${parts.join('; ')}`);
      } else if (onlyInA.length) {
        issues.push(`${group.name} ${baseKey}: ${group.a.prefix} has segment ids ${group.b.prefix} doesn't: ${previewList(onlyInA)}`);
      }
    }
  }

  return issues;
}
