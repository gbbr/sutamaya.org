// Rebuilds data/cips-index.json from a checkout of the Comprehensive Index of Pali Suttas.
//
// Optional, and off unless CIPS_PATH names one: the generated file is checked in, so a clone
// without the checkout builds from it unchanged. Get one from
// https://github.com/thesunshade/CIPS — the index itself is src/data/general-index.csv, three
// tab-separated columns of headword, sub-heading and citation.
//
// What comes out is the headwords alone, keyed by the sutta they cite. The sub-headings are dropped:
// they are free-text phrases about a passage ("escape from doubt"), and a search hit on one reads as
// a fragment of somebody else's sentence, where a headword reads as a label. Cross-reference rows
// ("see also …") cite no sutta and are dropped with them.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { indexTerm } from './update-data/index-terms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const PALI = path.join(DATA, 'pali', 'sutta');
export const INDEX_PATH = path.join(DATA, 'cips-index.json');

// How far the citation count may fall before the import refuses to write, the same guard the
// dictionary import uses: nothing downstream can tell a diminished index from a small one.
const MAX_SHRINK = 0.1;

// A batched leaf uid ("dhp320-333", "an1.82-97"), matching web/src/lib/corpus.ts's RANGE_UID.
const RANGE_UID = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)-(\d+)$/;
const RANGE_CITATION = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)$/;

// Every leaf uid the corpus ships, read from the Pali source rather than the build's output so the
// import doesn't depend on a build having run.
function leafUids() {
  const uids = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith('_root-pli-ms.json')) uids.add(entry.name.replace('_root-pli-ms.json', ''));
    }
  };
  walk(PALI);
  return uids;
}

// The document holding a citation: the uid itself, or the batch whose range covers it — CIPS cites
// "Dhp183", which this corpus ships inside "dhp179-196". Null for a collection we don't carry (Kp,
// Vv, Pv) and for CIPS's own CUSTOM rows.
export function resolveCitation(citation, uids, ranges) {
  const uid = citation.split(':')[0].trim().toLowerCase();
  if (!uid) return null;
  if (uids.has(uid)) return uid;
  const m = uid.match(RANGE_CITATION);
  if (!m) return null;
  const num = Number(m[2]);
  for (const [batch, range] of ranges) {
    if (range.prefix === m[1] && num >= range.start && num <= range.end) return batch;
  }
  return null;
}

// The commit the index was taken from, so a later refresh can say what moved. Absent when CIPS_PATH
// isn't a git checkout.
function sourceCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function runIndex({ cipsPath = process.env.CIPS_PATH || '', force = false } = {}) {
  if (!cipsPath) return { skipped: true };
  const csv = cipsPath.endsWith('.csv') ? cipsPath : path.join(cipsPath, 'src', 'data', 'general-index.csv');
  if (!fs.existsSync(csv)) throw new Error(`No index at ${csv} — CIPS_PATH should be a checkout of github.com/thesunshade/CIPS`);

  const uids = leafUids();
  const ranges = new Map();
  for (const uid of uids) {
    const m = uid.match(RANGE_UID);
    if (m) ranges.set(uid, { prefix: m[1], start: Number(m[2]), end: Number(m[3]) });
  }

  const terms = new Map();
  const aliases = {};
  let citations = 0;
  let unresolved = 0;
  for (const line of fs.readFileSync(csv, 'utf8').split('\n')) {
    const [headword, , citation] = line.split('\t');
    if (!headword || !citation || citation.startsWith('xref')) continue;
    const uid = resolveCitation(citation, uids, ranges);
    if (!uid) {
      unresolved += 1;
      continue;
    }
    citations += 1;
    const { label, alias } = indexTerm(headword);
    if (alias) aliases[label] = alias;
    if (!terms.has(uid)) terms.set(uid, new Set());
    terms.get(uid).add(label);
  }

  const previous = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : null;
  const previousCitations = previous?.citations ?? null;
  if (previousCitations && citations < previousCitations * (1 - MAX_SHRINK) && !force) {
    throw new Error(
      `Refusing to write ${path.basename(INDEX_PATH)}: ${citations.toLocaleString()} citations is ` +
        `${(((previousCitations - citations) / previousCitations) * 100).toFixed(1)}% fewer than the ` +
        `${previousCitations.toLocaleString()} it replaces.\n` +
        'To accept the loss anyway: npm run update-data index force'
    );
  }

  const sorted = [...terms].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  fs.writeFileSync(
    INDEX_PATH,
    `${JSON.stringify(
      {
        source: 'https://github.com/thesunshade/CIPS',
        sourceCommit: sourceCommit(cipsPath),
        citations,
        aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => (a < b ? -1 : 1))),
        terms: Object.fromEntries(sorted.map(([uid, set]) => [uid, [...set].sort()])),
      },
      null,
      2
    )}\n`
  );
  return {
    skipped: false,
    csv,
    citations,
    unresolved,
    suttas: terms.size,
    aliases: Object.keys(aliases).length,
    previousCitations,
    bytes: fs.statSync(INDEX_PATH).size,
  };
}
