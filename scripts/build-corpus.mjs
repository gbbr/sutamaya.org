#!/usr/bin/env node
// Reads /data (SuttaCentral-style Bilara JSON) and emits web/public/data/{corpus.json,dictionary.json,text/*.json}.
// See data/BRIEF.md for the raw data model, and CLAUDE.md for the browse-tree rules this encodes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NIKAYA_META, AN_BOOK_NAMES, KN_BOOKS, formatRef, flattenLeaves, findChapterNodes } from './lib/collections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'web', 'public', 'data');
const OUT_TEXT = path.join(OUT, 'text');

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function loadTree(id) {
  return readJSON(path.join(DATA, 'tree', `${id}-tree.json`))[id];
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
}
function buildFileIndex(dir) {
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

function loadSegMap(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Map();
  return new Map(Object.entries(readJSON(filePath)));
}

function buildBodySegments(paliMap, sujatoMap) {
  const orderedKeys = paliMap.size ? [...paliMap.keys()] : [...sujatoMap.keys()];
  const segs = [];
  for (const key of orderedKeys) {
    const segId = key.slice(key.indexOf(':') + 1);
    if (segId === '0' || segId.startsWith('0.')) continue; // nikaya/book/vagga/sutta title lines
    const pali = (paliMap.get(key) || '').trim();
    const en = (sujatoMap.get(key) || '').trim();
    if (!pali && !en) continue;
    segs.push({ key, pali, en });
  }
  return segs;
}

console.log('Indexing source files…');
const paliFiles = buildFileIndex(path.join(DATA, 'pali', 'sutta'));
const sujatoFiles = buildFileIndex(path.join(DATA, 'sujato', 'sutta'));
console.log(`  ${paliFiles.size} pali files, ${sujatoFiles.size} sujato files`);

const nameIndexCache = new Map();
function nameIndexFor(collection) {
  if (nameIndexCache.has(collection)) return nameIndexCache.get(collection);
  const idx = {
    pali: buildNameIndex(path.join(DATA, 'pali', 'name', `${collection}-name_root-misc-site.json`)),
    en: buildNameIndex(path.join(DATA, 'sujato', 'name', `${collection}-name_translation-en-sujato.json`)),
  };
  nameIndexCache.set(collection, idx);
  return idx;
}
const blurbIndexCache = new Map();
function blurbIndexFor(collection) {
  if (blurbIndexCache.has(collection)) return blurbIndexCache.get(collection);
  const idx = buildBlurbIndex(path.join(DATA, 'sujato', 'blurb', `${collection}-blurbs_root-en.json`));
  blurbIndexCache.set(collection, idx);
  return idx;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT_TEXT, { recursive: true });

const suttas = {};
let leafCount = 0;

// For a leaf that is exactly one segmented document (not a batch/range of several, like
// "an1.1-10"), the title lives *inside* that document as the last header line before the
// body — "0.1" is always the nikaya/book label, an optional "0.2" the vagga name, and
// (only when the sutta has its own title, as most do) the highest "0.N" is the sutta title
// itself. Batches don't have this — their segment keys are prefixed by the inner sutta uids
// (an1.1, an1.2, ...), never by the batch id — so this naturally only fires for true 1:1 docs.
function headerTitle(map, uid) {
  let best = null;
  let bestN = 1;
  for (const key of map.keys()) {
    const m = key.match(new RegExp(`^${uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:0\\.(\\d+)$`));
    if (m && +m[1] > bestN) {
      bestN = +m[1];
      best = map.get(key);
    }
  }
  return best ? best.trim() : null;
}

function buildLeaf(uid, nodeId, collection) {
  const names = nameIndexFor(collection);
  const blurbs = blurbIndexFor(collection);
  const paliPath = paliFiles.get(uid);
  const sujatoPath = sujatoFiles.get(uid);
  const paliMap = loadSegMap(paliPath);
  const sujatoMap = loadSegMap(sujatoPath);
  const segs = buildBodySegments(paliMap, sujatoMap);
  const words = segs.reduce((n, s) => n + (s.en ? s.en.split(/\s+/).filter(Boolean).length : 0), 0);
  const min = Math.max(1, Math.round(words / 200));

  fs.writeFileSync(path.join(OUT_TEXT, `${uid}.json`), JSON.stringify(segs.map(({ key, pali, en }) => ({ key, pali, en }))));

  suttas[uid] = {
    ref: formatRef(uid),
    node: nodeId,
    en: headerTitle(sujatoMap, uid) || names.en.get(uid) || formatRef(uid),
    pali: headerTitle(paliMap, uid) || names.pali.get(uid) || uid,
    blurb: blurbs.get(uid) || '',
    min,
  };
  leafCount += 1;
}

const nikayas = [];

// --- DN, MN: flatten straight to leaf suttas, no chapters ---
for (const id of ['dn', 'mn']) {
  const leaves = flattenLeaves(loadTree(id));
  leaves.forEach((uid) => buildLeaf(uid, id, id));
  nikayas.push({ id, label: NIKAYA_META[id].label, sub: NIKAYA_META[id].sub, count: leaves.length });
  console.log(`  ${id}: ${leaves.length} suttas`);
}

// --- SN: chapters (sn1, sn2, …) only, flattened straight to suttas within each ---
{
  const chapters = findChapterNodes(loadTree('sn'), /^sn\d+$/);
  chapters.sort((a, b) => {
    const na = +a.key.slice(2), nb = +b.key.slice(2);
    return na - nb;
  });
  const names = nameIndexFor('sn');
  const chapterRows = chapters.map(({ key, leaves }) => {
    leaves.forEach((uid) => buildLeaf(uid, key, 'sn'));
    const paliName = names.pali.get(key);
    return { id: key, label: `${formatRef(key)}${paliName ? ' · ' + paliName : ''}`, count: leaves.length };
  });
  nikayas.push({ id: 'sn', label: NIKAYA_META.sn.label, sub: NIKAYA_META.sn.sub, count: chapterRows.length, chapters: chapterRows });
  console.log(`  sn: ${chapterRows.length} chapters, ${chapterRows.reduce((n, c) => n + c.count, 0)} suttas`);
}

// --- AN: nipātas (an1 "Book of Ones", …) only, flattened straight to suttas within each ---
{
  const chapters = findChapterNodes(loadTree('an'), /^an\d+$/);
  chapters.sort((a, b) => {
    const na = +a.key.slice(2), nb = +b.key.slice(2);
    return na - nb;
  });
  const chapterRows = chapters.map(({ key, leaves }, i) => {
    leaves.forEach((uid) => buildLeaf(uid, key, 'an'));
    const bookName = AN_BOOK_NAMES[i] || `Book ${i + 1}`;
    return { id: key, label: `${formatRef(key)} · Book of ${bookName}`, count: leaves.length };
  });
  nikayas.push({ id: 'an', label: NIKAYA_META.an.label, sub: NIKAYA_META.an.sub, count: chapterRows.length, chapters: chapterRows });
  console.log(`  an: ${chapterRows.length} chapters, ${chapterRows.reduce((n, c) => n + c.count, 0)} suttas`);
}

// --- KN: all 20 books, each flattened one level down to its leaf documents ---
{
  const chapterRows = KN_BOOKS.map((book) => {
    const leaves = flattenLeaves(loadTree(book.id));
    leaves.forEach((uid) => buildLeaf(uid, book.id, book.id));
    return { id: book.id, label: book.label, sub: book.pali, count: leaves.length };
  });
  nikayas.push({ id: 'kn', label: NIKAYA_META.kn.label, sub: NIKAYA_META.kn.sub, count: chapterRows.length, chapters: chapterRows });
  console.log(`  kn: ${chapterRows.length} books, ${chapterRows.reduce((n, c) => n + c.count, 0)} leaf documents`);
}

fs.writeFileSync(path.join(OUT, 'corpus.json'), JSON.stringify({ nikayas, suttas }));
console.log(`Wrote corpus.json (${leafCount} leaf documents, ${nikayas.length} nikāyas)`);

// --- Dictionary: flatten [{entry, definition:[...]}] into a headword-keyed object for O(1) lookup ---
console.log('Building dictionary map…');
const dpdList = readJSON(path.join(DATA, 'pli2en_dpd.json'));
const dpdMap = {};
for (const { entry, definition } of dpdList) dpdMap[entry] = definition;
const dpdJson = JSON.stringify(dpdMap);
fs.writeFileSync(path.join(DATA, 'pli2en_dpd_map.json'), dpdJson);
fs.writeFileSync(path.join(OUT, 'dictionary.json'), dpdJson);
console.log(`  ${dpdList.length} headwords`);

console.log('Done.');
