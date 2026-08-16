// Shared helpers for scripts/update-data-{check,copy,post,snapshot}.mjs — see
// scripts/update-data/README.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared CLI colors for the update-data-{check,copy,post,snapshot}.mjs scripts — no color
// library needed for a handful of raw ANSI codes. Skipped outright when neither stdout nor stderr
// is a TTY (piped/redirected output, e.g. captured into a log file) or NO_COLOR is set, so a
// non-interactive run never has to look at escape codes.
const useColor = (!!process.stdout.isTTY || !!process.stderr.isTTY) && !process.env.NO_COLOR;
const wrapColor = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = wrapColor(91); // bright red — plain 31 reads too dark on a black background
export const green = wrapColor(32);
export const yellow = wrapColor(33);
export const blue = wrapColor(36);
export const bold = wrapColor(1);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');
export const DATA_ROOT = path.join(ROOT, 'data');
export const SUJATO_DIR = path.join(DATA_ROOT, 'sujato');
export const PALI_DIR = path.join(DATA_ROOT, 'pali');
export const HTML_DIR = path.join(DATA_ROOT, 'html');
export const SNAPSHOT_PATH = path.join(ROOT, 'scripts', 'update-data', 'snapshot.json');
// Provenance for all three dirs below comes from one sc-data checkout copied in one run, so one
// manifest covers them together — deliberately outside all three (a sibling, not nested under any
// of them), unlike the pre-multi-dir version where it lived inside data/sujato/.
export const MANIFEST_PATH = path.join(DATA_ROOT, 'manifest.json');

// The three local top-level dirs this pipeline keeps in sync with sc-data, keyed the same way
// every relPath below is prefixed (e.g. 'sujato/sutta/...', 'pali/name/...',
// 'html/pli/ms/sutta/...') so a relPath's first segment always resolves straight back to one of
// these.
export const DATA_DIRS = {
  sujato: SUJATO_DIR,
  pali: PALI_DIR,
  html: HTML_DIR,
};

// The Bilara-format subtree of a checked-out suttacentral/sc-data repo — translation/, comment/,
// root/, html/ etc. all live under here; the sibling dirs (dictionaries/, relationship/, ...) are
// unrelated to anything this pipeline mirrors.
const BILARA_SUBDIR = 'sc_bilara_data';

// {dataDir}/{category}/... -> its upstream sc_bilara_data path prefix, confirmed file-by-file
// against a real sc-data checkout. Everything after the matched prefix is the same relative path
// both locally and upstream, e.g. data/sujato/sutta/dn/dn8_translation-en-sujato.json <->
// sc_bilara_data/translation/en/sujato/sutta/dn/dn8_translation-en-sujato.json, or
// data/html/pli/ms/sutta/dn/dn8_html.json <-> sc_bilara_data/html/pli/ms/sutta/dn/dn8_html.json
// (html mirrors its upstream dir 1:1, so its own prefix is just itself).
const CATEGORY_SOURCE_PREFIXES = {
  'sujato/blurb': 'root/en/blurb',
  'sujato/name': 'translation/en/sujato/name/sutta',
  'sujato/sutta': 'translation/en/sujato/sutta',
  'sujato/notes': 'comment/en/sujato/sutta',
  'pali/sutta': 'root/pli/ms/sutta',
  'pali/name': 'root/misc/site/name/sutta',
  html: 'html',
};

// Longest (most specific) prefix first, so e.g. 'sujato/sutta' is tried before a hypothetical
// broader 'sujato' entry would be.
const SORTED_PREFIXES = Object.entries(CATEGORY_SOURCE_PREFIXES).sort((a, b) => b[0].length - a[0].length);

// Where a {dataDir}/{relPath} file lives in the sc-data checkout, or null if relPath doesn't
// start with a known category (see CATEGORY_SOURCE_PREFIXES).
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

// The local counterpart of sourcePathFor: {dataDir}/{relPath}'s absolute path, resolved via the
// relPath's own first segment ('sujato' | 'pali' | 'html') rather than a single fixed dir, since
// this pipeline now spans three of them. Overridable dataDirs so tests can point at fixture dirs.
export function localPathFor(relPath, dataDirs = DATA_DIRS) {
  const [dirName, ...rest] = relPath.split('/');
  const base = dataDirs[dirName];
  if (!base) throw new Error(`${relPath}: unrecognized data dir (expected one of ${Object.keys(dataDirs).join(', ')}).`);
  return path.join(base, ...rest);
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
        '  SC_DATA_PATH=/path/to/sc-data npm run update-data',
    );
  }
  const bilaraRoot = path.join(scDataPath, BILARA_SUBDIR);
  if (!fs.existsSync(bilaraRoot)) {
    throw new Error(`SC_DATA_PATH (${scDataPath}) has no ${BILARA_SUBDIR}/ subdirectory — is it a checkout of suttacentral/sc-data?`);
  }
  return { scDataPath, bilaraRoot };
}

// Which commit of SC_DATA_PATH we're about to copy from, for data/manifest.json.
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

// Relative (POSIX-style) paths of every tracked content file currently under dataDirs, each
// prefixed with its own dir name (e.g. 'sujato/sutta/dn/dn1_translation-en-sujato.json',
// 'pali/name/dn-name_root-misc-site.json', 'html/pli/ms/sutta/dn/dn1_html.json') — that prefix is
// what sourcePathFor/localPathFor key off of. Defaults to the real data/{sujato,pali,html}/;
// overridable so tests can point at fixture directories instead. manifest.json lives outside all
// three dirs (see MANIFEST_PATH) so it never needs filtering out here.
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

// Defaults to the real snapshot.json; overridable so tests can point it at a fixture file instead.
export function loadSnapshot(snapshotPath = SNAPSHOT_PATH) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`No snapshot at ${snapshotPath} — see scripts/update-data/README.md.`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
}

// Verifies data/{sujato,pali,html} itself still matches snapshot.json — independent of
// SC_DATA_PATH/bilaraRoot entirely, so it can run any time (in particular, as part of `npm test`)
// without a checkout of sc-data on hand. Catches a copy that got committed without a follow-up
// update-data:snapshot: since post-processing only ever changes values, never segment ids, a
// tracked file's keys should always still match what the snapshot recorded for it.
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
      // Kept terse (just what differs) — the "did you forget update-data:snapshot?" explanation
      // belongs once per run, not once per file (see update-data-check.mjs's CLI block).
      issues.push(`${relPath}: local keys differ from the snapshot (${expected.keyCount} → ${keys.length}).`);
    }
  }

  return { ok: issues.length === 0, issues };
}

// Segment-id relationships this pipeline expects to hold between two categories for the same
// underlying uid/range, confirmed against a real sc-data checkout — see CLAUDE.md's "Data
// pipeline" section. `suffix` is stripped (along with the category prefix itself) to get a base
// key shared across both sides of a group, e.g. 'pali/sutta/an/an1/an1.1-10_root-pli-ms.json' and
// 'html/pli/ms/sutta/an/an1/an1.1-10_html.json' both reduce to 'an/an1/an1.1-10'.
//
// Only the sutta body text is checked — blurb/notes have no pali counterpart at all, and the
// name-index files (pali/name vs sujato/name) don't reliably align even though they happen to for
// most books, so they're not a meaningful integrity signal.
export const INTEGRITY_GROUPS = [
  {
    // Pali root text and its SuttaCentral HTML structural mirror always describe the exact same
    // document (same segments, just different renderings of them), so their ids must match
    // exactly, in both directions.
    name: 'sutta text: pali vs html',
    kind: 'exact',
    a: { prefix: 'pali/sutta', suffix: '_root-pli-ms.json' },
    b: { prefix: 'html/pli/ms/sutta', suffix: '_html.json' },
  },
  {
    // Sujato's translation legitimately skips some Pali-only scribal colophon lines (e.g.
    // "Tevijjasuttaṁ niṭṭhitaṁ terasamaṁ.") that pali/html both always carry — see CLAUDE.md's
    // note on buildBodySegments' Pali fallback for role: 'end' segments — so this direction only:
    // every segment id sujato has must also exist in pali, never the reverse. That's what
    // actually matters here: it catches a segment genuinely added to the translation without its
    // Pali counterpart, which would break interlinear Pali/role-tagging for that segment, without
    // flagging the expected (harmless) colophon-only gap the other way.
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

// Cross-checks every INTEGRITY_GROUPS group across the given relPaths, using keysFor(relPath) to
// read each file's segment ids (upstream via sourcePathFor, or local via localPathFor — the
// caller decides which). Returns a flat list of issue strings.
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
        // 'exact' groups expect both sides always present together, so either one missing is
        // worth flagging. 'subset' groups only care about the subset side having no counterpart
        // to check against — a superset-only file (e.g. a Pali range with no Sujato translation
        // at all) is normal and not this check's concern.
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
