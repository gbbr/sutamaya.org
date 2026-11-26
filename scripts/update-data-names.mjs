// Rebuilds data/pli2en_dppn.json — the proper-names entries for the names a tap can reach — from
// Ānandajoti Bhikkhu's revision of G. P. Malalasekera's Dictionary of Pāli Proper Names.
//
// Optional, and off unless DPPN_PATH names the DPPN.json in DPD's other-dictionaries repository
// (dictionaries/dppn/dppn.tar.zst). SC_DATA_PATH supplies SuttaCentral's page and verse references,
// which turn each entry's citations into the suttas it cites. DPD_DB_PATH, when set, adds what DPD
// records about each sense — its example suttas and notes — which tells apart senses glossed alike.
//
// What comes out is the candidate list, not what ships: for each name DPD glosses "name of …", the
// entries whose citations reach the app's books. data/names/README.md says how they are reviewed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { requireSourceRoot } from './lib/dataSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
export const NAMES_PATH = path.join(DATA, 'pli2en_dppn.json');
const DICT_PATH = path.join(DATA, 'pli2en_dpd.json');
const PALI_SUTTA = path.join(DATA, 'pali', 'sutta');

// The app's books, each with its directory under SuttaCentral's references.
const BOOKS = { dn: 'dn', mn: 'mn', sn: 'sn', an: 'an', dhp: 'kn/dhp', ud: 'kn/ud', iti: 'kn/iti', snp: 'kn/snp', thag: 'kn/thag', thig: 'kn/thig' };

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };

// Tags an entry keeps; everything else is dropped and its text kept.
const KEPT_TAGS = ['p', 'b', 'i', 'ul', 'li'];

// Returns the text of an HTML fragment.
export const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Returns the key two spellings of one name share: lowercase, ṁ for the niggahita, l for ḷ, and no
// spaces or hyphens.
export const nameKey = (text) => text.toLowerCase().replace(/ṃ/g, 'ṁ').replace(/ḷ/g, 'l').replace(/[\s\-’']/g, '');

// Orders SuttaCentral ids as the canon runs: "sn1.10" after "sn1.9".
export function naturalOrder(a, b) {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    if (pa[i] === pb[i]) continue;
    if (i % 2 === 1) return Number(pa[i]) - Number(pb[i]);
    return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

// Returns an entry's HTML with only KEPT_TAGS, none of their attributes, and tidy whitespace.
export function cleanHtml(html) {
  return html
    .replace(/<(\/?)([a-z]+)[^>]*>/gi, (_, close, name) => (KEPT_TAGS.includes(name.toLowerCase()) ? `<${close}${name.toLowerCase()}>` : ''))
    .replace(/<(?!\/?(?:p|b|i|ul|li)>)[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(<\/(?:p|li|ul)>)/g, '$1')
    .replace(/(<(?:p|li|ul)>)\s+/g, '$1')
    .trim();
}

// Returns the places a text cites in the app's books, as referenceIndex keys — "mn 1.68",
// "thag v868", "ud p13" — or as the sutta number a citation names outright ("mn105", "an1.32").
// Commentaries, cited with an "-a" ("SN-a.i.240"), are not among them.
export function citations(text) {
  const keys = [];
  for (const [, book, vol, page] of text.matchAll(/\b(DN|MN|SN|AN)\.([ivx]+)\.(\d+)/g)) {
    if (ROMAN[vol]) keys.push(`${book.toLowerCase()} ${ROMAN[vol]}.${page}`);
  }
  for (const [, book, number] of text.matchAll(/\b(DN|MN|SN|AN|Ud|Iti|Snp|Thag|Thig) (\d+(?:\.\d+)?)\b/g)) {
    keys.push(`${book.toLowerCase()}${number}`);
  }
  for (const [, book, kind, number] of text.matchAll(/\b(Dhp|Snp|Thag|Thig)(?!-a)\.?\s?(vv?\.|vs\.|p\.)?\s?(\d+)(?!\.\d)/g)) {
    keys.push(`${book.toLowerCase()} ${kind === 'p.' ? 'p' : 'v'}${number}`);
  }
  for (const [, chapter, sutta] of text.matchAll(/\bUd(?!-a)\.([ivx]+)\.(\d+)/g)) {
    if (ROMAN[chapter]) keys.push(`ud${ROMAN[chapter]}.${sutta}`);
  }
  for (const [, book, page] of text.matchAll(/\b(Ud|Iti|It)(?!-a)\.?\s?(?:p\.)?\s?(\d+)/g)) {
    keys.push(`${book === 'Ud' ? 'ud' : 'iti'} p${page}`);
  }
  return keys;
}

// Returns the suttas on each page and verse of the app's books, from SuttaCentral's references:
// "dn 2.81" → the suttas that page holds, "thag v868" → the poem with that verse. A sutta that
// starts partway down a page is on that page too. The first Saṁyutta volume goes by its first
// edition, which the dictionary cites.
function referenceIndex(root) {
  const index = new Map();
  const add = (key, uid) => {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(uid);
  };
  for (const [book, dir] of Object.entries(BOOKS)) {
    const files = fs
      .readdirSync(path.join(root, dir), { recursive: true })
      .filter((file) => file.endsWith('_reference.json'))
      .map((file) => ({ uid: path.basename(file).split('_')[0], file: path.join(root, dir, file) }))
      .sort((a, b) => naturalOrder(a.uid, b.uid));
    let page = null;
    for (const { uid, file } of files) {
      if (page) add(page, uid);
      for (const refs of Object.values(JSON.parse(fs.readFileSync(file, 'utf8')))) {
        for (const [, vol, number] of refs.matchAll(/pts-vp-pli(?:1ed)?(\d+)(?!ed)(?:\.(\d+))?/g)) {
          page = number ? `${book} ${vol}.${number}` : `${book} p${vol}`;
          add(page, uid);
        }
        for (const [, verse] of refs.matchAll(/\bvnp(\d+)\b/g)) add(`${book} v${verse}`, uid);
      }
    }
  }
  return index;
}

// Returns the id of every sutta in the app.
function corpusSuttas() {
  return new Set(
    fs
      .readdirSync(PALI_SUTTA, { recursive: true })
      .filter((file) => file.endsWith('_root-pli-ms.json'))
      .map((file) => path.basename(file).split('_')[0])
  );
}

// Returns a function from a sutta number ("an1.32") to the app's sutta holding it — itself, or the
// group it is printed in ("an1.21-40") — or null.
function suttaResolver(inApp) {
  const groups = new Map();
  for (const uid of inApp) {
    const match = uid.match(/^(.*\D)(\d+)-(\d+)$/);
    if (!match) continue;
    if (!groups.has(match[1])) groups.set(match[1], []);
    groups.get(match[1]).push({ uid, from: Number(match[2]), to: Number(match[3]) });
  }
  return (number) => {
    if (inApp.has(number)) return number;
    const match = number.match(/^(.*\D)(\d+)$/);
    const group = match && groups.get(match[1])?.find(({ from, to }) => from <= Number(match[2]) && Number(match[2]) <= to);
    return group ? group.uid : null;
  };
}

// Returns the names a tap can reach, by nameKey: each DPD headword glossed "name of …", with its
// gloss.
function tappableNames() {
  const { entries } = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  const names = new Map();
  for (const { definition } of entries) {
    for (const line of definition) {
      const match = line.match(/^(?:\S+ → )?(.+?): \S+\. <b>([^<]*)<\/b>/);
      if (!match || !/\bname of\b/.test(match[2])) continue;
      const key = nameKey(match[1].replace(/ [\d.]+$/, ''));
      if (!names.has(key)) names.set(key, {});
      names.get(key)[match[1]] = match[2];
    }
  }
  return names;
}

// Returns the dictionary's entries by nameKey, each with an id unique across the dictionary
// ("Citta 01", or "Aciravatī (2)" for the second of two unnumbered entries) and the rest of its
// heading ("(called Cittagahapati)").
function dppnEntries(list) {
  const byKey = new Map();
  const seen = new Map();
  for (const { name, entry } of list) {
    if (/class="Heading/.test(name)) continue;
    const bold = name.match(/<b>(.*?)<\/b>/);
    const head = bold && plain(bold[1]);
    if (!head) continue;
    const label = plain(name);
    const rest = label.startsWith(head) ? label.slice(head.length) : '';
    const number = rest.match(/^\s*(\d+)\s*\./);
    let id = number ? `${head} ${number[1]}` : head;
    const count = (seen.get(id) || 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id} (${count})`;
    const aka = rest.replace(/^\s*(\d+\s*)?\.?\s*/, '').replace(/\.\s*$/, '').trim();
    const key = nameKey(head);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ id, aka, entry });
  }
  return byKey;
}

// Returns a function from a sense ("tissa 2.4") to what DPD records about it — "TH40 · SN21.9 —
// Theragāthā verse 39 … is attributed to him." — or '' without a database.
function senseHints(dbPath) {
  if (!dbPath) return () => '';
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const query = db.prepare('select source_1, source_2, notes from dpd_headwords where lemma_1 = ?');
  return (lemma) => {
    const row = query.get(lemma.replace(/ṁ/g, 'ṃ'));
    if (!row) return '';
    const sources = [row.source_1, row.source_2].filter(Boolean).join(' · ');
    const notes = (row.notes || '').replace(/\s+/g, ' ').trim();
    return [sources, notes].filter(Boolean).join(' — ').replace(/ṃ/g, 'ṁ');
  };
}

// Writes data/pli2en_dppn.json from DPPN_PATH and returns what it did, or `{ skipped: true }` when no
// file is named.
export function runNames({ dppnPath = process.env.DPPN_PATH || '', dbPath = process.env.DPD_DB_PATH || '' } = {}) {
  if (!dppnPath) return { skipped: true };
  if (!fs.existsSync(dppnPath)) throw new Error(`DPPN_PATH does not exist: ${dppnPath}`);
  const raw = fs.readFileSync(dppnPath);
  const list = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(list) || typeof list[0]?.name !== 'string') {
    throw new Error(`${dppnPath} is not DPPN.json — expected a list of {name, entry}`);
  }

  const { bilaraRoot } = requireSourceRoot();
  const index = referenceIndex(path.join(bilaraRoot, 'reference', 'pli', 'ms', 'sutta'));
  const inApp = corpusSuttas();
  const resolve = suttaResolver(inApp);
  const byKey = dppnEntries(list);
  const tappable = tappableNames();
  const hintFor = senseHints(dbPath);

  const names = {};
  let entries = 0;
  let unplaced = 0;
  for (const [key, senses] of [...tappable].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const kept = [];
    for (const { id, aka, entry } of byKey.get(key) || []) {
      const keys = citations(plain(entry));
      if (!keys.length) continue;
      const cites = new Set();
      for (const k of keys) for (const uid of k.includes(' ') ? index.get(k) || [] : [resolve(k)]) if (inApp.has(uid)) cites.add(uid);
      if (!cites.size) unplaced += 1;
      kept.push({ id, ...(aka && { aka }), cites: [...cites].sort(naturalOrder), html: cleanHtml(`<p>${entry}`) });
    }
    if (!kept.length) continue;
    const hints = Object.fromEntries(Object.keys(senses).map((lemma) => [lemma, hintFor(lemma)]).filter(([, hint]) => hint));
    names[key] = { senses, ...(Object.keys(hints).length && { hints }), entries: kept };
    entries += kept.length;
  }

  const json = `${JSON.stringify({ dppn: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12), names }, null, 1)}\n`;
  fs.writeFileSync(NAMES_PATH, json);
  return { dppnPath, tappable: tappable.size, names: Object.keys(names).length, entries, unplaced, bytes: Buffer.byteLength(json) };
}
