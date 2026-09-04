#!/usr/bin/env node
// Reads data/ (SuttaCentral-style Bilara JSON) and emits web/public/data/: corpus.json, text/,
// text-shards/, dict-shards/ and search/.
// See data/README.md for the raw data model, and CLAUDE.md for the browse-tree rules this encodes.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  NIKAYA_META, AN_BOOK_NAMES, KN_BOOKS, SN_GROUPS, REF_ABBR, RESTATED_CHAPTERS,
  formatRef, stripTitlePrefix, flattenLeaves, findChapterNodes, findNodeByKey, findLeafGroups, rangeNote, chapterSpanNote,
  headerTitle, buildBodySegments,
} from './lib/collections.js';
import { splitPaliWords, stripPunct, lookupWord, shardFor } from './lib/paliWords.js';
import { red, green, bold, dim } from './lib/dataSync.js';

// The build's output vocabulary: `step` heads a phase, `detail` reports its counts, `ok` marks a
// check that passed, and a failure prints its message in red rather than a stack trace.
const step = (text) => console.log(bold(text));
const detail = (text) => console.log(dim(`  ${text}`));
const ok = (text) => console.log(`  ${green('✓')} ${text}`);
process.on('uncaughtException', (err) => {
  console.error(`\n  ${red('✗ build:corpus failed')}\n\n${err.message.replace(/^/gm, '  ')}\n`);
  process.exit(1);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
// The English the corpus is built from: upstream Sujato with this app's editorial rules applied,
// written by `npm run update-data post` (see docs/retranslation.md).
const SUJATO = path.join(DATA, 'sujato.post');
// Output directory, wiped and rewritten on every build. Overridable so a test run writes to a
// temporary tree rather than deleting the corpus a dev server is serving.
const OUT = process.env.CORPUS_OUT || path.join(ROOT, 'web', 'public', 'data');
const OUT_TEXT = path.join(OUT, 'text');
const OUT_SHARDS = path.join(OUT, 'text-shards');
const OUT_SEARCH = path.join(OUT, 'search');

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Returns a 16-hex-char digest of `s` — a change detector, not a security digest.
function sha256(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}
// Loads one collection's browse tree from data/tree/, naming the collection and path on failure.
function loadTree(id) {
  const treePath = path.join(DATA, 'tree', `${id}-tree.json`);
  try {
    return readJSON(treePath)[id];
  } catch (err) {
    throw new Error(`Failed to load tree for collection "${id}" from ${treePath}: ${err.message}`);
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
}
// Indexes every .json file under `dir` by uid — the basename up to the first underscore. `hint`
// names the command that fetches the directory, for the error when it doesn't exist.
function buildFileIndex(dir, hint) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Missing data directory: ${dir}${hint ? ` — ${hint}` : ''}`);
  }
  const files = [];
  walk(dir, files);
  const index = new Map();
  for (const f of files) index.set(path.basename(f).split('_')[0], f);
  return index;
}

function buildNameIndex(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  for (const [key, value] of Object.entries(readJSON(filePath))) {
    const afterColon = key.slice(key.indexOf(':') + 1);
    const dot = afterColon.indexOf('.');
    const refUid = dot === -1 ? afterColon : afterColon.slice(dot + 1);
    map.set(refUid, value.trim());
  }
  return map;
}
function buildBlurbIndex(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  for (const [key, value] of Object.entries(readJSON(filePath))) {
    map.set(key.slice(key.indexOf(':') + 1), value.trim());
  }
  return map;
}

// Removes the inline HTML a blurb carries, for the rows that draw a blurb as plain text.
function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

function loadSegMap(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Map();
  return new Map(Object.entries(readJSON(filePath)));
}

const sujatoManifest = readJSON(path.join(DATA, 'manifest.json'));

step('Indexing source files…');
const paliFiles = buildFileIndex(path.join(DATA, 'pali', 'sutta'));
const sujatoFiles = buildFileIndex(path.join(SUJATO, 'sutta'), 'run `npm run update-data post` first');
const htmlFiles = buildFileIndex(path.join(DATA, 'html', 'pli', 'ms', 'sutta'), 'run `node scripts/fetch-html-structure.mjs` first');
const notesFiles = buildFileIndex(path.join(SUJATO, 'notes'));
detail(
  `${paliFiles.size} pali files, ${sujatoFiles.size} sujato files, ${htmlFiles.size} html structure files, ${notesFiles.size} note files`
);

const nameIndexCache = new Map();
function nameIndexFor(collection) {
  if (nameIndexCache.has(collection)) return nameIndexCache.get(collection);
  const idx = {
    pali: buildNameIndex(path.join(DATA, 'pali', 'name', `${collection}-name_root-misc-site.json`)),
    en: buildNameIndex(path.join(SUJATO, 'name', `${collection}-name_translation-en-sujato.json`)),
  };
  nameIndexCache.set(collection, idx);
  return idx;
}
const blurbIndexCache = new Map();
function blurbIndexFor(collection) {
  if (blurbIndexCache.has(collection)) return blurbIndexCache.get(collection);
  const idx = buildBlurbIndex(path.join(SUJATO, 'blurb', `${collection}-blurbs_root-en.json`));
  blurbIndexCache.set(collection, idx);
  return idx;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT_TEXT, { recursive: true });
fs.mkdirSync(OUT_SHARDS, { recursive: true });
fs.mkdirSync(OUT_SEARCH, { recursive: true });

const suttas = {};
let leafCount = 0;

// Every Pali token the reader can tap, gathered as the leaves are written.
const tappableWords = new Set();

// Per-uid digest of the bytes written to text/, folded into corpus.json's `dataVersion`.
const textDigests = new Map();

// Target size of one text shard: the bundles Settings' bulk offline download fetches instead of
// one request per sutta — see web/src/lib/offline.ts.
const SHARD_TARGET_BYTES = 1_000_000;
let shardBuf = [];
let shardBufBytes = 0;
let shardIndex = 0;
const shardManifest = [];

function flushShard() {
  if (shardBuf.length === 0) return;
  const file = `text-shards/${String(shardIndex).padStart(3, '0')}.json`;
  const body = `{${shardBuf.map(([uid, json]) => `${JSON.stringify(uid)}:${json}`).join(',')}}`;
  fs.writeFileSync(path.join(OUT, file), body);
  shardManifest.push({ file, bytes: Buffer.byteLength(body), uids: shardBuf.map(([uid]) => uid) });
  shardIndex += 1;
  shardBuf = [];
  shardBufBytes = 0;
}

// Full-text search reads two line-per-segment blobs of the whole canon rather than an index — see
// docs/search.md. Both carry the same lines in the same order, so an offset in one addresses the
// same segment in the other, and `searchMap` resolves an offset to its sutta.
//
// Line holding nothing else that opens each paragraph and each sutta.
const PARA_MARK = '\x1e';
const searchEnLines = [];
const searchPaLines = [];
const searchMap = [];
let searchEnChars = 0;
let searchPaChars = 0;

// Appends one line to each blob, keeping the two aligned. Offsets are UTF-16 code units, which is
// how the client indexes the string it downloads.
function pushSearchLine(en, pa) {
  searchEnLines.push(en);
  searchPaLines.push(pa);
  searchEnChars += en.length + 1;
  searchPaChars += pa.length + 1;
}

// Returns `s` with the separators that would break the line-per-segment structure replaced.
function searchLine(s) {
  return s.replace(/[\r\n\x1e]+/g, ' ');
}

// The paragraph a segment key names, qualified by the sutta it belongs to — "mn10:2.1" is
// "mn10:2". A batched document's inner suttas each restart at paragraph 1.
function paragraphOf(key) {
  const colon = key.indexOf(':');
  const afterColon = key.slice(colon + 1);
  const dot = afterColon.indexOf('.');
  return key.slice(0, colon + 1) + (dot === -1 ? afterColon : afterColon.slice(0, dot));
}

// Adds one sutta's segments to the search blobs, and records where it starts in each.
function addToSearchBlobs(uid, segs) {
  searchMap.push([uid, searchEnChars, searchPaChars]);
  pushSearchLine(PARA_MARK, PARA_MARK);
  let para = segs.length ? paragraphOf(segs[0].key) : null;
  for (const seg of segs) {
    const p = paragraphOf(seg.key);
    if (p !== para) {
      pushSearchLine(PARA_MARK, PARA_MARK);
      para = p;
    }
    pushSearchLine(searchLine(seg.en || ''), searchLine(seg.pali || ''));
  }
}

function buildLeaf(uid, nodeId, collection) {
  const names = nameIndexFor(collection);
  const blurbs = blurbIndexFor(collection);
  const paliPath = paliFiles.get(uid);
  const sujatoPath = sujatoFiles.get(uid);
  const paliMap = loadSegMap(paliPath);
  const sujatoMap = loadSegMap(sujatoPath);
  const htmlMap = loadSegMap(htmlFiles.get(uid));
  const notesMap = loadSegMap(notesFiles.get(uid));
  const segs = buildBodySegments(paliMap, sujatoMap, htmlMap, notesMap);
  // The exact strings SegmentedText renders as tappable `.pw` spans.
  for (const seg of segs) {
    if (seg.pali) for (const word of splitPaliWords(seg.pali)) tappableWords.add(word);
  }
  const words = segs.reduce((n, s) => n + (s.en ? s.en.split(/\s+/).filter(Boolean).length : 0), 0);
  const min = Math.max(1, Math.round(words / 200));

  const segsJson = JSON.stringify(
    segs.map(({ key, pali, en, role, headingLevel, note }) => ({
      key,
      pali,
      en,
      ...(role ? { role } : null),
      ...(headingLevel ? { headingLevel } : null),
      ...(note ? { note } : null),
    }))
  );
  fs.writeFileSync(path.join(OUT_TEXT, `${uid}.json`), segsJson);
  textDigests.set(uid, sha256(segsJson));
  addToSearchBlobs(uid, segs);

  shardBuf.push([uid, segsJson]);
  shardBufBytes += Buffer.byteLength(segsJson);
  if (shardBufBytes >= SHARD_TARGET_BYTES) flushShard();

  suttas[uid] = {
    ref: formatRef(uid),
    node: nodeId,
    en: headerTitle(sujatoMap, uid) || stripTitlePrefix(names.en.get(uid)) || formatRef(uid),
    pali: headerTitle(paliMap, uid) || names.pali.get(uid) || formatRef(uid),
    blurb: stripTags(blurbs.get(uid) || ''),
    min,
  };
  leafCount += 1;
}

/**
 * Builds the vagga-level rows under one chapter from findLeafGroups() output, building each row's
 * leaves as it goes, and returns `{ rows, label }` for the chapter to carry.
 *   ref        – the sutta-range note ("SN35.1–12", "MN1–10"), a vagga having no short ref of its own
 *   chapterRef – that range's prefix: a string, or a function of a category's own leaves where the
 *                numbering restarts per category (snp1.1…, ud3.1…)
 *   dotted     – "{ref}.{n}" (sn/an) rather than "{ref}{n}" (mn)
 * A lone category that only restates its chapter — same label, or listed in RESTATED_CHAPTERS — is
 * collapsed away: `rows` comes back undefined and its leaves are tagged with `chapterKey`.
 */
function buildCategoryRows(categories, collection, chapterKey, chapterLabel, chapterRef, dotted) {
  const names = nameIndexFor(collection);
  const blurbs = blurbIndexFor(collection);
  const meta = categories.map(({ key, leaves }) => {
    const paliName = names.pali.get(key);
    return { key, leaves, paliName, label: stripTitlePrefix(names.en.get(key)) || paliName || key };
  });
  if (meta.length === 1 && (meta[0].label === chapterLabel || chapterKey in RESTATED_CHAPTERS)) {
    meta[0].leaves.forEach((uid) => buildLeaf(uid, chapterKey, collection));
    return { rows: undefined, label: RESTATED_CHAPTERS[chapterKey] ?? chapterLabel };
  }
  const rows = meta.map(({ key, leaves, label, paliName }) => {
    leaves.forEach((uid) => buildLeaf(uid, key, collection));
    const blurb = blurbs.get(key);
    return {
      id: key,
      ref: rangeNote(typeof chapterRef === 'function' ? chapterRef(leaves) : chapterRef, leaves, dotted),
      label,
      sub: paliName,
      count: leaves.length,
      ...(blurb ? { blurb } : null),
    };
  });
  return { rows, label: chapterLabel };
}

// Builds one chapter row (sn1, an3, …) from a findChapterNodes() entry, with its vagga-level rows
// underneath. `labelOverride` carries AN's chapter label ("Book of Ones"), which comes from a
// hardcoded name list rather than the name index SN's chapters use.
function buildChapterRow({ key, node, leaves }, collection, dotted, labelOverride) {
  const names = nameIndexFor(collection);
  const chapterRef = formatRef(key);
  const paliName = names.pali.get(key);
  const chapterLabel = labelOverride ?? (stripTitlePrefix(names.en.get(key)) || paliName || chapterRef);
  const { rows, label } = buildCategoryRows(findLeafGroups(node), collection, key, chapterLabel, chapterRef, dotted);
  const blurb = blurbIndexFor(collection).get(key);
  return {
    id: key,
    ref: chapterRef,
    label,
    sub: paliName,
    count: leaves.length,
    ...(blurb ? { blurb } : null),
    chapters: rows,
  };
}

const nikayas = [];

// --- DN: its 3 vaggas, each holding its suttas directly ---
{
  const { rows: categoryRows } = buildCategoryRows(findLeafGroups(loadTree('dn')), 'dn', 'dn', NIKAYA_META.dn.label, 'DN', false);
  nikayas.push({ id: 'dn', label: NIKAYA_META.dn.label, sub: NIKAYA_META.dn.sub, count: categoryRows.length, chapters: categoryRows });
  detail(`dn: ${categoryRows.length} categories, ${categoryRows.reduce((n, c) => n + c.count, 0)} suttas`);
}

// --- MN: its 15 vaggas directly, its 3 "fifty" (pannasa) wrappers flattened away ---
{
  const { rows: categoryRows } = buildCategoryRows(findLeafGroups(loadTree('mn')), 'mn', 'mn', NIKAYA_META.mn.label, 'MN', false);
  nikayas.push({ id: 'mn', label: NIKAYA_META.mn.label, sub: NIKAYA_META.mn.sub, count: categoryRows.length, chapters: categoryRows });
  detail(`mn: ${categoryRows.length} categories, ${categoryRows.reduce((n, c) => n + c.count, 0)} suttas`);
}

// --- SN: 5 super-vagga groups (Verses, Causation, …), each wrapping its sn1..sn56 chapters, each
// of those split into vaggas with any "fifty" (pannasaka) wrapper flattened away ---
{
  const tree = loadTree('sn');
  const names = nameIndexFor('sn');
  const blurbs = blurbIndexFor('sn');
  const groupRows = SN_GROUPS.map((group) => {
    const groupNode = findNodeByKey(tree, group.id);
    const chapterNodes = findChapterNodes(groupNode, /^sn\d+$/);
    chapterNodes.sort((a, b) => +a.key.slice(2) - +b.key.slice(2));
    const chapterRows = chapterNodes.map((c) => buildChapterRow(c, 'sn', true));
    const totalSuttas = chapterRows.reduce((n, c) => n + c.count, 0);
    return {
      id: group.id,
      ref: chapterSpanNote('SN', chapterRows[0].id, chapterRows[chapterRows.length - 1].id),
      label: group.label,
      sub: names.pali.get(group.id),
      count: totalSuttas,
      ...(blurbs.get(group.id) ? { blurb: blurbs.get(group.id) } : null),
      chapters: chapterRows,
    };
  });
  const totalChapters = groupRows.reduce((n, g) => n + g.chapters.length, 0);
  const totalSuttas = groupRows.reduce((n, g) => n + g.count, 0);
  nikayas.push({ id: 'sn', label: NIKAYA_META.sn.label, sub: NIKAYA_META.sn.sub, count: groupRows.length, chapters: groupRows });
  detail(`sn: ${groupRows.length} groups, ${totalChapters} chapters, ${totalSuttas} suttas`);
}

// --- AN: nipātas (an1 "Book of Ones", …), each split into vaggas with any "fifty" (pannasaka)
// wrapper flattened away ---
{
  const chapters = findChapterNodes(loadTree('an'), /^an\d+$/);
  chapters.sort((a, b) => +a.key.slice(2) - +b.key.slice(2));
  const chapterRows = chapters.map((c, i) => buildChapterRow(c, 'an', true, `Book of ${AN_BOOK_NAMES[i] || `Book ${i + 1}`}`));
  nikayas.push({ id: 'an', label: NIKAYA_META.an.label, sub: NIKAYA_META.an.sub, count: chapterRows.length, chapters: chapterRows });
  detail(`an: ${chapterRows.length} chapters, ${chapterRows.reduce((n, c) => n + c.count, 0)} suttas`);
}

// --- KN: 6 curated books, flattened one level down to their leaf documents — except Snp and Ud,
// which keep their vagga rows (see KN_BOOKS) ---
{
  const chapterRows = KN_BOOKS.map((book) => {
    const tree = loadTree(book.id);
    const leaves = flattenLeaves(tree);
    const ref = REF_ABBR[book.id] || book.id.toUpperCase();
    const row = { id: book.id, ref, label: book.label, sub: book.pali, count: leaves.length };
    if (!book.vaggas) {
      leaves.forEach((uid) => buildLeaf(uid, book.id, book.id));
      return row;
    }
    // Each vagga's range badge takes its prefix from its own leaves ("Snp3.1–12").
    const vaggaRef = (vaggaLeaves) => formatRef(vaggaLeaves[0].slice(0, vaggaLeaves[0].lastIndexOf('.')));
    const { rows } = buildCategoryRows(findLeafGroups(tree), book.id, book.id, book.label, vaggaRef, true);
    return { ...row, chapters: rows };
  });
  nikayas.push({ id: 'kn', label: NIKAYA_META.kn.label, sub: NIKAYA_META.kn.sub, count: chapterRows.length, chapters: chapterRows });
  detail(`kn: ${chapterRows.length} books, ${chapterRows.reduce((n, c) => n + c.count, 0)} leaf documents`);
}

// --- Dictionary: flatten [{entry, definition:[...]}] into a headword-keyed object, trim it to the
// words this build emitted, then split it into the range shards a word tap fetches one of — see
// lib/dictionaryShards.ts ---
step('Building dictionary shards…');
const dictPath = path.join(DATA, 'pli2en_dpd.json');
const { dpdVersion, entries: dpdList } = readJSON(dictPath);
// Names the file and the command to regenerate it, rather than crashing on an undefined `entries`.
if (!Array.isArray(dpdList)) {
  throw new Error(
    `${dictPath} is not in the expected {dpdVersion, entries: [...]} shape.\n` +
      'Regenerate it: DPD_DB_PATH=/path/to/dpd.db npm run update-data dictionary'
  );
}
const dpdMap = {};
for (const { entry, definition } of dpdList) dpdMap[entry] = definition;

// The keep-set: for each tappable token, the pair lookupWord consults — the token and its
// lowercase form.
const reachable = new Set();
for (const raw of tappableWords) {
  const word = stripPunct(raw);
  if (!word) continue;
  reachable.add(word);
  reachable.add(word.toLowerCase());
}

const shipped = {};
for (const [key, def] of Object.entries(dpdMap)) {
  if (reachable.has(key)) shipped[key] = def;
}
const dpdJson = JSON.stringify(shipped);
detail(`${Object.keys(shipped).length} of ${dpdList.length} headwords reachable from this corpus`);

// Target size of one dictionary shard.
const DICT_SHARD_TARGET_BYTES = 256 * 1024;
// The key a shard range is addressed by. Ordered with plain code-unit comparison, never
// localeCompare: lib/dictionaryShards.ts's binary search has to reproduce this ordering exactly.
const dictSortKey = (k) => k.toLowerCase();
const headwords = Object.keys(shipped).sort((a, b) => {
  const ka = dictSortKey(a);
  const kb = dictSortKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
});

const dictShards = [];
let dictShardKeys = [];
let dictShardBytes = 0;
for (const key of headwords) {
  const bytes = JSON.stringify(key).length + JSON.stringify(shipped[key]).length + 2;
  // A run of headwords sharing a sort key ("Buddha"/"buddha") is never split — one lookup
  // consults both spellings.
  const canSplit = dictShardKeys.length > 0 && dictSortKey(dictShardKeys[dictShardKeys.length - 1]) !== dictSortKey(key);
  if (dictShardBytes + bytes > DICT_SHARD_TARGET_BYTES && canSplit) {
    dictShards.push(dictShardKeys);
    dictShardKeys = [];
    dictShardBytes = 0;
  }
  dictShardKeys.push(key);
  dictShardBytes += bytes;
}
if (dictShardKeys.length) dictShards.push(dictShardKeys);

fs.mkdirSync(path.join(OUT, 'dict-shards'), { recursive: true });
const dictManifest = dictShards.map((keys, i) => {
  const file = `dict-shards/${String(i).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(Object.fromEntries(keys.map((k) => [k, shipped[k]]))));
  return { file, first: dictSortKey(keys[0]), last: dictSortKey(keys[keys.length - 1]) };
});
fs.writeFileSync(path.join(OUT, 'dict-shards', 'manifest.json'), JSON.stringify({ shards: dictManifest }));
detail(`${headwords.length} headwords in ${dictShards.length} shards`);

// --- Verify the trim by replaying it: every tappable word goes through the same manifest binary
// search and lookupWord the client runs, against the shards just written, and the answer is
// compared with data/pli2en_dpd.json's. It proves the shards agree with that file, not that the
// file is sound — update-data-dictionary.mjs checks that at import ---
{
  const bodies = new Map();
  const shardBody = (file) => {
    if (!bodies.has(file)) bodies.set(file, readJSON(path.join(OUT, file)));
    return bodies.get(file);
  };
  const lost = [];
  for (const raw of tappableWords) {
    const before = lookupWord(dpdMap, raw);
    if (!before) continue;
    const key = stripPunct(raw).toLowerCase();
    const shard = key ? shardFor(dictManifest, key) : null;
    const after = shard ? lookupWord(shardBody(shard.file), raw) : null;
    if (!after) lost.push(`${raw} (was: ${before[0]})`);
    else if (after[0] !== before[0]) lost.push(`${raw} (was: ${before[0]}, now: ${after[0]})`);
  }
  if (lost.length) {
    throw new Error(
      `Dictionary trim lost ${lost.length} word(s) the reader can tap:\n  ${lost.slice(0, 20).join('\n  ')}` +
        (lost.length > 20 ? `\n  …and ${lost.length - 20} more` : '')
    );
  }
  ok(`verified: all ${tappableWords.size} tappable words resolve exactly as data/pli2en_dpd.json defines them`);

  // Coverage over the distinct words this build emitted. Numerals are counted apart: verse and
  // list numbering is tappable too.
  const forms = new Set();
  for (const raw of tappableWords) {
    const word = stripPunct(raw);
    if (word) forms.add(word);
  }
  let defined = 0;
  let numerals = 0;
  for (const form of forms) {
    if (shipped[form] || shipped[form.toLowerCase()]) defined += 1;
    else if (/^[0-9.–-]+$/.test(form)) numerals += 1;
  }
  ok(
    `coverage: ${defined} of ${forms.size} distinct words have a definition ` +
      dim(`(${forms.size - defined - numerals} have none, ${numerals} are numerals)`)
  );
}

// Two of the three versions corpus.json carries, kept apart so a reworded sutta doesn't invalidate
// the dictionary. Sorting by uid keeps dataVersion independent of directory-walk order.
const dataVersion = sha256(
  [...textDigests]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([uid, digest]) => `${uid}:${digest}`)
    .join('\n')
);
const dictionaryVersion = sha256(dpdJson);

// --- Search blobs, named with a hash of themselves so a corrected corpus arrives as a new URL
// rather than as a stale hit ---
step('Writing the search text…');
const searchEn = searchEnLines.join('\n');
const searchPa = searchPaLines.join('\n');
const searchMapJson = JSON.stringify(searchMap);
// Over the blobs' own bytes rather than over text/: they carry the same segments but not the same
// bytes, so how they are written can change while every text/ file stays identical.
const searchVersion = sha256(`${searchEn}\n${searchPa}\n${searchMapJson}`);
fs.writeFileSync(path.join(OUT_SEARCH, `en.${searchVersion}.txt`), searchEn);
fs.writeFileSync(path.join(OUT_SEARCH, `pa.${searchVersion}.txt`), searchPa);
fs.writeFileSync(path.join(OUT_SEARCH, `map.${searchVersion}.json`), searchMapJson);
detail(
  `${searchMap.length} suttas, ${searchEnLines.length} lines — ` +
    `en ${(searchEn.length / 1e6).toFixed(1)} MB, pali ${(searchPa.length / 1e6).toFixed(1)} MB, ` +
    `search ${searchVersion}`
);

step('Writing the corpus…');
fs.writeFileSync(
  path.join(OUT, 'corpus.json'),
  JSON.stringify({
    nikayas,
    suttas,
    sujatoCommit: sujatoManifest.sourceCommit,
    dataVersion,
    searchVersion,
    dictionaryVersion,
    dpdVersion,
  })
);
detail(`corpus.json — ${leafCount} leaf documents, ${nikayas.length} nikāyas, data ${dataVersion}`);

flushShard();
const totalShardBytes = shardManifest.reduce((n, s) => n + s.bytes, 0);
fs.writeFileSync(
  path.join(OUT_SHARDS, 'manifest.json'),
  JSON.stringify({ totalBytes: totalShardBytes, totalUids: leafCount, shards: shardManifest })
);
detail(`${shardManifest.length} text shards (${(totalShardBytes / 1e6).toFixed(1)} MB) for offline bulk download`);

console.log(`\n  ${green('✓ build:corpus complete')}\n`);
