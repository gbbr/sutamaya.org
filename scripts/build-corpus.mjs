#!/usr/bin/env node
// Reads /data (SuttaCentral-style Bilara JSON) and emits web/public/data/{corpus.json,dictionary.json,text/*.json}.
// See data/BRIEF.md for the raw data model, and CLAUDE.md for the browse-tree rules this encodes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NIKAYA_META, AN_BOOK_NAMES, KN_BOOKS, SN_GROUPS, REF_ABBR,
  formatRef, stripTitlePrefix, flattenLeaves, findChapterNodes, findNodeByKey, findLeafGroups, rangeNote, chapterSpanNote,
} from './lib/collections.js';

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

// SuttaCentral's own structural markup (see data/html/pli/ms/sutta/, fetched by
// scripts/fetch-html-structure.mjs from bilara-data's `html/` tree) gives a per-segment HTML
// template — this is language-independent structure (a verse is a verse regardless of
// translation), so one `html/` file covers both the Pali and English text for the same segment
// keys. Checked in this order (a segment matches at most one, based on inspecting a broad sample
// of the actual data — see that script's own comment):
//   - `heading`: a `<h2>`/`<h3>` sub-heading inside a longer document (e.g. DN9's internal
//     sections), not to be confused with the "0.*" title lines already stripped above.
//   - `verse`: `<span class='verse-line'>` inside a `<blockquote class='gatha'>` — a line of
//     poetry, vs. plain `<p>` for prose. Also covers the `uddanagatha`/`vagguddanagatha` mnemonic
//     verses at a chapter's end, which nest `verse-line` the same way.
//   - `end`: a closing colophon note (`endsutta`, `endvagga`, `endsection`, `endbook`, `endkanda`,
//     bare `end`, and `uddana-intro` — "Their mnemonic:") — often Pali-only (see buildLeaf, which
//     falls back to Pali for these when there's no English at all, rather than leaving a blank
//     paragraph the tap-to-reveal interaction would otherwise never make visible).
//   - `speaker`: an inline dialogue attribution embedded mid-verse (e.g. "said the Buddha,").
const HEADING_RE = /^<h[23]>/;
const VERSE_LINE_RE = /class=['"]verse-line['"]/;
const END_RE = /class=['"](?:end\w*|uddana-intro)['"]/;
const SPEAKER_RE = /class=['"]speaker['"]/;

function roleFor(template) {
  if (!template) return undefined;
  if (HEADING_RE.test(template)) return 'heading';
  if (VERSE_LINE_RE.test(template)) return 'verse';
  if (END_RE.test(template)) return 'end';
  if (SPEAKER_RE.test(template)) return 'speaker';
  return undefined;
}

// Sujato's own translator notes (data/sujato/notes/, same uid/segment-keyed, range-batched files
// as everything else — see data/BRIEF.md) carry inline HTML (`<i>`/`<em>`/<b>`/`<span>`, kept
// as-is) and cross-reference links to other suttas on suttacentral.net (`<a href='https://
// suttacentral.net/...'>`) — stripped down to their plain text here rather than kept as live
// links, since a link off to the actual live website doesn't belong in an offline-first reader
// (and may point at a sutta this dataset doesn't even have translated).
const NOTE_LINK_RE = /<a\b[^>]*>(.*?)<\/a>/gis;
function cleanNote(text) {
  return text.replace(NOTE_LINK_RE, '$1').trim();
}

function buildBodySegments(paliMap, sujatoMap, htmlMap, notesMap) {
  const orderedKeys = paliMap.size ? [...paliMap.keys()] : [...sujatoMap.keys()];
  const segs = [];
  for (const key of orderedKeys) {
    const segId = key.slice(key.indexOf(':') + 1);
    if (segId === '0' || segId.startsWith('0.')) continue; // nikaya/book/vagga/sutta title lines
    const pali = (paliMap.get(key) || '').trim();
    let en = (sujatoMap.get(key) || '').trim();
    if (!pali && !en) continue;
    const role = roleFor(htmlMap.get(key));
    // A colophon note ("Tevijjasuttaṁ niṭṭhitaṁ terasamaṁ." — "The Tevijja Sutta is finished")
    // is frequently Pali-only, since it's a scribal marker rather than teaching content Sujato
    // translated — falling back to Pali here (only for this role) means the reader always has
    // *something* to show for it, instead of a blank paragraph with nothing to tap-reveal.
    if (role === 'end' && !en) en = pali;
    const seg = { key, pali, en };
    if (role) seg.role = role;
    const rawNote = notesMap.get(key);
    if (rawNote && rawNote.trim()) seg.note = cleanNote(rawNote);
    segs.push(seg);
  }
  return segs;
}

console.log('Indexing source files…');
const paliFiles = buildFileIndex(path.join(DATA, 'pali', 'sutta'));
const sujatoFiles = buildFileIndex(path.join(DATA, 'sujato', 'sutta'));
const htmlFiles = buildFileIndex(path.join(DATA, 'html', 'pli', 'ms', 'sutta'));
const notesFiles = buildFileIndex(path.join(DATA, 'sujato', 'notes'));
console.log(
  `  ${paliFiles.size} pali files, ${sujatoFiles.size} sujato files, ${htmlFiles.size} html structure files, ${notesFiles.size} note files`
);

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
  const htmlMap = loadSegMap(htmlFiles.get(uid));
  const notesMap = loadSegMap(notesFiles.get(uid));
  const segs = buildBodySegments(paliMap, sujatoMap, htmlMap, notesMap);
  const words = segs.reduce((n, s) => n + (s.en ? s.en.split(/\s+/).filter(Boolean).length : 0), 0);
  const min = Math.max(1, Math.round(words / 200));

  fs.writeFileSync(
    path.join(OUT_TEXT, `${uid}.json`),
    JSON.stringify(
      segs.map(({ key, pali, en, role, note }) => ({ key, pali, en, ...(role ? { role } : null), ...(note ? { note } : null) }))
    )
  );

  suttas[uid] = {
    ref: formatRef(uid),
    node: nodeId,
    en: headerTitle(sujatoMap, uid) || stripTitlePrefix(names.en.get(uid)) || formatRef(uid),
    pali: headerTitle(paliMap, uid) || names.pali.get(uid) || uid,
    blurb: blurbs.get(uid) || '',
    min,
  };
  leafCount += 1;
}

// Builds category rows (vagga-level) from findLeafGroups() output: one row per category, with
// its member leaves built and its `ref` set to the sutta-range note ("SN35.1–12", "MN1–10")
// rather than a plain ref, since a vagga has no canonical short ref of its own — the range is
// the most useful thing to show. `dotted` selects "{ref}.{n}" (sn/an) vs "{ref}{n}" (mn).
//
// Exception: if there's exactly one category and its label is identical to the *chapter's*
// own label (e.g. SN13 "Comprehension" containing only a single "Comprehension" vagga — the
// vagga name is a pointless restatement of the chapter it's the whole of), that extra nesting
// level is redundant, so it's skipped: returns `undefined` (no `chapters` array, meaning the
// chapter itself becomes the leaf) and tags the leaves with `chapterKey` directly instead of
// the otherwise-identical category key.
function buildCategoryRows(categories, collection, chapterKey, chapterLabel, chapterRef, dotted) {
  const names = nameIndexFor(collection);
  const meta = categories.map(({ key, leaves }) => {
    const paliName = names.pali.get(key);
    return { key, leaves, paliName, label: stripTitlePrefix(names.en.get(key)) || paliName || key };
  });
  if (meta.length === 1 && meta[0].label === chapterLabel) {
    meta[0].leaves.forEach((uid) => buildLeaf(uid, chapterKey, collection));
    return undefined;
  }
  return meta.map(({ key, leaves, label, paliName }) => {
    leaves.forEach((uid) => buildLeaf(uid, key, collection));
    return { id: key, ref: rangeNote(chapterRef, leaves, dotted), label, sub: paliName, count: leaves.length };
  });
}

const nikayas = [];

// --- DN: flatten straight to leaf suttas, no chapters ---
{
  const leaves = flattenLeaves(loadTree('dn'));
  leaves.forEach((uid) => buildLeaf(uid, 'dn', 'dn'));
  nikayas.push({ id: 'dn', label: NIKAYA_META.dn.label, sub: NIKAYA_META.dn.sub, count: leaves.length });
  console.log(`  dn: ${leaves.length} suttas`);
}

// --- MN: vagga-level categories directly (MN has no numbered-chapter layer of its own), with
// its 3 "fifty" (pannasa) wrapper groups flattened away structurally ---
{
  const categoryRows = buildCategoryRows(findLeafGroups(loadTree('mn')), 'mn', 'mn', NIKAYA_META.mn.label, 'MN', false);
  nikayas.push({ id: 'mn', label: NIKAYA_META.mn.label, sub: NIKAYA_META.mn.sub, count: categoryRows.length, chapters: categoryRows });
  console.log(`  mn: ${categoryRows.length} categories, ${categoryRows.reduce((n, c) => n + c.count, 0)} suttas`);
}

// --- SN: 5 super-vagga groups (Verses, Causation, …), each wrapping its sn1..sn56 chapters;
// each chapter further split into vagga-level categories, with any "fifty" (pannasaka)
// wrapper layer flattened away structurally (see findLeafGroups) rather than shown as a row.
{
  const tree = loadTree('sn');
  const names = nameIndexFor('sn');
  const groupRows = SN_GROUPS.map((group) => {
    const groupNode = findNodeByKey(tree, group.id);
    const chapterNodes = findChapterNodes(groupNode, /^sn\d+$/);
    chapterNodes.sort((a, b) => +a.key.slice(2) - +b.key.slice(2));
    const chapterRows = chapterNodes.map(({ key: chapterKey, node: chapterNode, leaves: allLeaves }) => {
      const chapterRef = formatRef(chapterKey);
      const paliName = names.pali.get(chapterKey);
      const chapterLabel = stripTitlePrefix(names.en.get(chapterKey)) || paliName || chapterRef;
      const categoryRows = buildCategoryRows(findLeafGroups(chapterNode), 'sn', chapterKey, chapterLabel, chapterRef, true);
      return {
        id: chapterKey,
        ref: chapterRef,
        label: chapterLabel,
        sub: paliName,
        count: allLeaves.length,
        chapters: categoryRows,
      };
    });
    const totalSuttas = chapterRows.reduce((n, c) => n + c.count, 0);
    return {
      id: group.id,
      ref: chapterSpanNote('SN', chapterRows[0].id, chapterRows[chapterRows.length - 1].id),
      label: group.label,
      sub: names.pali.get(group.id),
      count: totalSuttas,
      chapters: chapterRows,
    };
  });
  const totalChapters = groupRows.reduce((n, g) => n + g.chapters.length, 0);
  const totalSuttas = groupRows.reduce((n, g) => n + g.count, 0);
  nikayas.push({ id: 'sn', label: NIKAYA_META.sn.label, sub: NIKAYA_META.sn.sub, count: groupRows.length, chapters: groupRows });
  console.log(`  sn: ${groupRows.length} groups, ${totalChapters} chapters, ${totalSuttas} suttas`);
}

// --- AN: nipātas (an1 "Book of Ones", …), each split into vagga-level categories, with any
// "fifty" (pannasaka) wrapper layer flattened away structurally ---
{
  const chapters = findChapterNodes(loadTree('an'), /^an\d+$/);
  chapters.sort((a, b) => +a.key.slice(2) - +b.key.slice(2));
  const names = nameIndexFor('an');
  const chapterRows = chapters.map(({ key, node, leaves: allLeaves }, i) => {
    const chapterRef = formatRef(key);
    const bookName = AN_BOOK_NAMES[i] || `Book ${i + 1}`;
    const chapterLabel = `Book of ${bookName}`;
    const categoryRows = buildCategoryRows(findLeafGroups(node), 'an', key, chapterLabel, chapterRef, true);
    return { id: key, ref: chapterRef, label: chapterLabel, sub: names.pali.get(key), count: allLeaves.length, chapters: categoryRows };
  });
  nikayas.push({ id: 'an', label: NIKAYA_META.an.label, sub: NIKAYA_META.an.sub, count: chapterRows.length, chapters: chapterRows });
  console.log(`  an: ${chapterRows.length} chapters, ${chapterRows.reduce((n, c) => n + c.count, 0)} suttas`);
}

// --- KN: all 20 books, each flattened one level down to its leaf documents ---
{
  const chapterRows = KN_BOOKS.map((book) => {
    const leaves = flattenLeaves(loadTree(book.id));
    leaves.forEach((uid) => buildLeaf(uid, book.id, book.id));
    const ref = REF_ABBR[book.id] || book.id.toUpperCase();
    return { id: book.id, ref, label: book.label, sub: book.pali, count: leaves.length };
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
