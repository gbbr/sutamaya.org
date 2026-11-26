#!/usr/bin/env node
// The review of data/pli2en_dppn.json's candidates, which data/names/README.md describes.
//
//   node scripts/names-review.mjs packets          write data/names/review/packets/, one file per batch
//   node scripts/names-review.mjs check [second]   validate data/names/decisions/ (or second/)
//   node scripts/names-review.mjs compare          list where the two readings differ
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitPaliWords, stripPunct } from './lib/paliWords.js';
import { NAMES_PATH, naturalOrder, plain } from './update-data-names.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const PACKETS = path.join(DATA, 'names', 'review', 'packets');
const DECISIONS = path.join(DATA, 'names', 'decisions');
const SECOND = path.join(DATA, 'names', 'second');

// Target size of one packet, which keeps a batch to one sitting.
const PACKET_TARGET_BYTES = 60 * 1024;
// Mentions a packet quotes for a name with a single entry, which needs no sutta-by-sutta decision.
const SAMPLE_MENTIONS = 4;
// Mentions a packet quotes per sutta for a name with several entries; the rest are in the sutta.
const MENTIONS_PER_SUTTA = 2;
// Characters of an entry a packet quotes.
const ENTRY_CHARS = 3000;
// Characters of a segment a packet quotes.
const SEGMENT_CHARS = 260;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const lemmaOf = (line) => line.match(/^(?:\S+ → )?(.+?): \S+\. <b>/)?.[1];
const cut = (text, n) => (text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, '')} …`);

// Returns each sutta's segments, by id, for the Pali and for Sujato's English.
function corpus() {
  const read = (dir, suffix) => {
    const out = new Map();
    for (const file of fs.readdirSync(dir, { recursive: true })) {
      if (file.endsWith(suffix)) out.set(path.basename(file).split('_')[0], readJson(path.join(dir, file)));
    }
    return out;
  };
  return { pali: read(path.join(DATA, 'pali', 'sutta'), '_root-pli-ms.json'), english: read(path.join(DATA, 'sujato', 'sutta'), '_translation-en-sujato.json') };
}

// Returns every mention of each name in the app's suttas, as {uid, segment, form} lists: a word whose
// dictionary lines, as a tap finds them, include one of the name's senses. Where the word has other
// senses too (citta, "mind"), it counts only when Sujato's English names the person — the Pali
// doesn't capitalise names, the English does — in the segment, or in the sutta where the segment
// has no English (a verse's attribution line).
function mentions(names, pali, english) {
  const dict = {};
  for (const { entry, definition } of readJson(path.join(DATA, 'pli2en_dpd.json')).entries) dict[entry] = definition;
  const nameOfLemma = new Map();
  const inEnglish = new Map();
  for (const [key, { senses, entries }] of Object.entries(names)) {
    for (const lemma of Object.keys(senses)) nameOfLemma.set(lemma, key);
    const stem = entries[0].id.replace(/( \d+)?( \(\d+\))?$/, '').replace(/\s+/g, '').replace(/[aāiīuū]$/, '');
    inEnglish.set(key, new RegExp(`(?<!\\p{L})${(stem[0].toUpperCase() + stem.slice(1)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'));
  }
  const forms = new Map();
  const formInfo = (form) => {
    if (!forms.has(form)) {
      const lemmas = dict[form].map(lemmaOf).filter(Boolean);
      const keys = new Set(lemmas.filter((l) => nameOfLemma.has(l)).map((l) => nameOfLemma.get(l)));
      forms.set(form, { keys, ambiguous: (key) => lemmas.some((l) => nameOfLemma.get(l) !== key) });
    }
    return forms.get(form);
  };
  const found = new Map(Object.keys(names).map((key) => [key, []]));
  for (const [uid, segments] of [...pali].sort(([a], [b]) => naturalOrder(a, b))) {
    const suttaEnglish = Object.values(english.get(uid) || {}).join(' ');
    for (const [segment, text] of Object.entries(segments)) {
      const segmentEnglish = (english.get(uid)?.[segment] || '').trim();
      for (const token of splitPaliWords(text)) {
        const word = stripPunct(token);
        const form = !word ? null : dict[word] ? word : dict[word.toLowerCase()] ? word.toLowerCase() : null;
        if (!form) continue;
        const { keys, ambiguous } = formInfo(form);
        for (const key of keys) {
          if (ambiguous(key) && !inEnglish.get(key).test(segmentEnglish || suttaEnglish)) continue;
          const list = found.get(key);
          if (!list.some((m) => m.uid === uid && m.segment === segment)) list.push({ uid, segment, form: word });
        }
      }
    }
  }
  return found;
}

// Returns one name's section of a packet.
function section(key, { senses, hints = {}, entries }, found, english, pali) {
  const lines = [`## ${key}`, '', "DPD senses — each is one line in the dictionary panel — with DPD's own example suttas and notes:"];
  for (const [lemma, gloss] of Object.entries(senses)) lines.push(`- \`${lemma}\` — ${gloss}${hints[lemma] ? ` ⟨DPD: ${hints[lemma]}⟩` : ''}`);
  lines.push('', 'Entries:');
  for (const e of entries) {
    lines.push('', `### \`${e.id}\`${e.aka ? ` ${e.aka}` : ''} — cites ${e.cites.length ? e.cites.join(' ') : 'nothing the references place'}`);
    lines.push(`> ${cut(plain(e.html.replace(/<\/(p|li)>/g, '</$1> ')), ENTRY_CHARS)}`);
  }
  const suttas = new Set(found.map((m) => m.uid));
  const perSutta = new Map();
  const quoted =
    entries.length > 1
      ? found.filter((m) => (perSutta.set(m.uid, (perSutta.get(m.uid) || 0) + 1), perSutta.get(m.uid) <= MENTIONS_PER_SUTTA))
      : found.slice(0, SAMPLE_MENTIONS);
  lines.push('', `Mentions — ${found.length} segment(s) in ${suttas.size} sutta(s)${quoted.length < found.length ? `, ${quoted.length} quoted` : ''}:`);
  for (const { uid, segment, form } of quoted) {
    lines.push(`- \`${segment}\` (${form}) — ${cut(pali.get(uid)?.[segment] || '', SEGMENT_CHARS)} ‖ ${cut(english.get(uid)?.[segment] || '', SEGMENT_CHARS)}`);
  }
  if (entries.length > 1) lines.push('', `Suttas a decision may name: ${[...suttas].join(' ') || 'none'}`);
  return `${lines.join('\n')}\n`;
}

function packets() {
  const { names } = readJson(NAMES_PATH);
  const { pali, english } = corpus();
  const found = mentions(names, pali, english);
  fs.rmSync(PACKETS, { recursive: true, force: true });
  fs.mkdirSync(PACKETS, { recursive: true });
  const batches = [];
  let current = { names: [], text: '' };
  for (const key of Object.keys(names).sort()) {
    const text = section(key, names[key], found.get(key), english, pali);
    if (current.names.length && Buffer.byteLength(current.text + text) > PACKET_TARGET_BYTES) {
      batches.push(current);
      current = { names: [], text: '' };
    }
    current.names.push(key);
    current.text += `${text}\n`;
  }
  if (current.names.length) batches.push(current);
  const index = {};
  batches.forEach((batch, i) => {
    const id = String(i + 1).padStart(3, '0');
    fs.writeFileSync(path.join(PACKETS, `${id}.md`), `# Batch ${id}\n\n${batch.text}`);
    index[id] = { names: batch.names, suttas: Object.fromEntries(batch.names.map((k) => [k, [...new Set(found.get(k).map((m) => m.uid))]])) };
  });
  fs.writeFileSync(path.join(PACKETS, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  console.log(`${batches.length} packets for ${Object.keys(names).length} names in ${path.relative(process.cwd(), PACKETS)}/`);
  return 0;
}

// Validates every reviewed batch: complete, covering each of its names and each name's senses,
// naming only that name's entries, each in one place, and only suttas that mention the name, each
// for one entry at most.
function check(which) {
  const { names } = readJson(NAMES_PATH);
  const index = readJson(path.join(PACKETS, 'index.json'));
  const folder = which === 'second' ? SECOND : DECISIONS;
  const problems = [];
  let reviewed = 0;
  let kept = 0;
  let identified = 0;
  for (const [id, { names: keys, suttas }] of Object.entries(index)) {
    const file = path.join(folder, `${id}.json`);
    if (!fs.existsSync(file)) continue;
    let decision;
    try {
      decision = readJson(file);
    } catch (err) {
      problems.push(`${id}: not JSON — ${err.message}`);
      continue;
    }
    if (decision.done !== true) {
      problems.push(`${id}: not marked done`);
      continue;
    }
    reviewed += 1;
    for (const key of keys) {
      const d = decision.names?.[key];
      if (!d) {
        problems.push(`${id} ${key}: no decision`);
        continue;
      }
      const ids = new Set(names[key].entries.map((e) => e.id));
      const senses = Object.keys(names[key].senses);
      for (const lemma of senses) if (!Array.isArray(d.senses?.[lemma])) problems.push(`${id} ${key}: no decision for sense ${lemma}`);
      const used = new Set();
      for (const [lemma, list] of Object.entries(d.senses || {})) {
        if (!senses.includes(lemma)) problems.push(`${id} ${key}: unknown sense ${lemma}`);
        for (const entry of list || []) (ids.has(entry) ? used.add(entry) : problems.push(`${id} ${key}: unknown entry ${entry}`));
      }
      for (const entry of d.others || []) {
        if (!ids.has(entry)) problems.push(`${id} ${key}: unknown entry ${entry}`);
        else if (used.has(entry)) problems.push(`${id} ${key}: ${entry} is in a sense and in others`);
        else used.add(entry);
      }
      kept += used.size;
      const seen = new Map();
      for (const [entry, list] of Object.entries(d.suttas || {})) {
        if (!used.has(entry)) problems.push(`${id} ${key}: suttas for ${entry}, which does not ship`);
        for (const uid of list) {
          if (!suttas[key].includes(uid)) problems.push(`${id} ${key}: ${uid} does not mention the name`);
          if (seen.has(uid)) problems.push(`${id} ${key}: ${uid} given to ${seen.get(uid)} and ${entry}`);
          seen.set(uid, entry);
          identified += 1;
        }
      }
    }
  }
  console.log(`${reviewed} of ${Object.keys(index).length} batches reviewed — ${kept} entries kept, ${identified} sutta identifications`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  return problems.length ? 1 : 0;
}

// Lists, name by name, where the two readings differ: an entry placed differently (under a sense,
// in others, or not shipping) or a sutta given to a different entry or to none.
function compare() {
  const index = readJson(path.join(PACKETS, 'index.json'));
  const placement = (d, entry) => {
    for (const [lemma, list] of Object.entries(d.senses || {})) if (list.includes(entry)) return lemma;
    return (d.others || []).includes(entry) ? 'others' : 'not shipping';
  };
  const owner = (d) => new Map(Object.entries(d.suttas || {}).flatMap(([entry, list]) => list.map((uid) => [uid, entry])));
  const { names } = readJson(NAMES_PATH);
  let differ = 0;
  for (const [id, { names: keys }] of Object.entries(index)) {
    const a = fs.existsSync(path.join(DECISIONS, `${id}.json`)) ? readJson(path.join(DECISIONS, `${id}.json`)).names : null;
    const b = fs.existsSync(path.join(SECOND, `${id}.json`)) ? readJson(path.join(SECOND, `${id}.json`)).names : null;
    if (!a || !b) continue;
    for (const key of keys) {
      const lines = [];
      for (const { id: entry } of names[key].entries) {
        const [pa, pb] = [placement(a[key], entry), placement(b[key], entry)];
        if (pa !== pb) lines.push(`${entry}: ${pa} ≠ ${pb}`);
      }
      const [oa, ob] = [owner(a[key]), owner(b[key])];
      for (const uid of new Set([...oa.keys(), ...ob.keys()])) {
        if (oa.get(uid) !== ob.get(uid)) lines.push(`${uid}: ${oa.get(uid) || 'none'} ≠ ${ob.get(uid) || 'none'}`);
      }
      if (!lines.length) continue;
      differ += 1;
      console.log(`${id} ${key}\n  ${lines.join('\n  ')}`);
    }
  }
  console.log(`${differ} name(s) differ`);
  return 0;
}

const [command, arg] = process.argv.slice(2);
const run = { packets, check, compare }[command];
if (!run) {
  console.error('Usage: node scripts/names-review.mjs packets|check [second]|compare');
  process.exit(2);
}
process.exit(run(arg));
