// Rebuilds data/pli2en_dpd.json from a Digital Pali Dictionary release database.
//
// Optional, and off unless DPD_DB_PATH names a dpd.db: the generated file is checked in, so a
// clone without the database builds from it unchanged. Get one from
// https://github.com/digitalpalidictionary/dpd-db/releases (the dpd.db.tar.xz asset).
//
// What comes out is not DPD: only the headwords a tap in this corpus can reach, and per headword
// only the gloss lines the dictionary dock renders — no examples, citations, frequencies,
// inflection tables or other scripts. That is what fits a ~2.3GB database into a file the app ships.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { splitPaliWords, stripPunct } from './lib/paliWords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const PALI = path.join(DATA, 'pali');
export const DICT_PATH = path.join(DATA, 'pli2en_dpd.json');

// Returns the DPD spellings of a SuttaCentral word: SuttaCentral writes the niggahita as ṁ, and
// assimilated as ṅ before a velar and ñ before h, where DPD keys all of them as ṃ. Orthographic
// conversion only — every candidate is a spelling of the same word, not a near match to it.
export function dpdSpellings(word) {
  const niggahita = word.replace(/ṁ/g, 'ṃ');
  return [...new Set([word, niggahita, niggahita.replace(/ṅ(?=[kg])/g, 'ṃ'), niggahita.replace(/ñ(?=h)/g, 'ṃ')])];
}

// The reverse, for anything DPD hands back that the dock displays beside the sutta's own spelling.
const scSpelling = (text) => text.replace(/ṃ/g, 'ṁ');

const niggahita = (text) => text.toLowerCase().replace(/ṁ/g, 'ṃ');

function editDistance(a, b) {
  let previous = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// Whether `candidate` is `word` spelled another way — the test a reading pulled out of DPD's
// free-form `variant` prose has to pass before it is treated as this word at all.
export const isVariantOf = (word, candidate) =>
  editDistance(niggahita(word), niggahita(candidate)) <= Math.max(2, Math.round(niggahita(word).length * 0.3));

// The candidates that are variants of `word`, nearest spelling first — the editions store their
// readings in no useful order.
export const variantsClosestFirst = (word, candidates) =>
  candidates
    .filter((candidate) => isVariantOf(word, candidate))
    .sort((a, b) => editDistance(niggahita(word), niggahita(a)) - editDistance(niggahita(word), niggahita(b)));

// Returns every Pali word in data/pali/ — a superset of what the reader can tap, which build-corpus
// trims again to exactly what it emitted.
function corpusWords() {
  const words = new Set();
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  };
  walk(PALI);
  for (const file of files) {
    for (const value of Object.values(JSON.parse(fs.readFileSync(file, 'utf8')))) {
      if (typeof value !== 'string') continue;
      for (const token of splitPaliWords(value)) {
        const word = stripPunct(token);
        if (word) words.add(word);
      }
    }
  }
  return words;
}

const parseJson = (raw) => {
  try {
    return JSON.parse(raw || 'null');
  } catch {
    return null;
  }
};
const asArray = (raw) => {
  const value = parseJson(raw);
  return Array.isArray(value) ? value : [];
};

// How far the headword count may fall against the file being replaced before the import refuses to
// write. Nothing downstream can catch the loss: build-corpus verifies the shards against this file,
// so a diminished file verifies perfectly.
const MAX_SHRINK = 0.1;

// The two queries the import asks a few hundred thousand times, prepared once per database.
const prepared = new WeakMap();
function statements(db) {
  let cached = prepared.get(db);
  if (!cached) {
    cached = {
      lookupRow: db.prepare('select headwords, deconstructor, variant, see, spelling from lookup where lookup_key = ?'),
      headword: db.prepare('select lemma_1, pos, meaning_1, meaning_lit, meaning_2, construction from dpd_headwords where id = ?'),
    };
    prepared.set(db, cached);
  }
  return cached;
}

// Returns one word's definition lines as the dock renders them, or null when nothing in DPD glosses
// it. All of the import's judgement lives here.
export function defineWord(db, word) {
  const { lookupRow, headword } = statements(db);

  const rowFor = (candidate) => {
    for (const spelling of dpdSpellings(candidate)) {
      const row = lookupRow.get(spelling) || lookupRow.get(spelling.toLowerCase());
      if (row) return row;
    }
    return null;
  };

  // One rendered definition: lemma, part of speech, the meaning in bold, then the literal reading
  // and the construction. A headword with no meaning — DPD carries some as pure cross-references —
  // contributes nothing.
  function glossLine(id) {
    const h = headword.get(Number(id));
    if (!h) return null;
    const meaning = h.meaning_1 || h.meaning_2;
    if (!meaning) return null;
    const lit = h.meaning_lit ? `; lit. ${h.meaning_lit}` : '';
    const construction = h.construction ? ` [${h.construction.split('\n')[0]}]` : '';
    return scSpelling(`${h.lemma_1}: ${h.pos}. <b>${meaning}</b>${lit}${construction}`);
  }

  const glossLines = (row) => asArray(row?.headwords).map(glossLine).filter(Boolean);

  // The readings in a row's manuscript variants, which DPD records as
  // {edition: {text: [[context, "reading (sigla)"]]}}. Each is only a candidate here — a reading is
  // used only if it is itself a glossed headword.
  function variantReadings(row) {
    const variants = parseJson(row?.variant);
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return [];
    const readings = new Set();
    for (const byText of Object.values(variants)) {
      for (const entries of Object.values(byText || {})) {
        for (const entry of entries || []) {
          const reading = Array.isArray(entry) ? entry[entry.length - 1] : entry;
          if (typeof reading !== 'string') continue;
          for (const token of reading.split(/[^A-Za-zāīūṁṃṅñṭḍṇḷṝśṣ]+/)) if (token.length > 2) readings.add(token);
        }
      }
    }
    return [...readings];
  }

  // Prefixes a gloss with the compound part it came from, unless the lemma is already that part.
  const attribute = (part, line) => {
    const lemma = line.slice(0, line.indexOf(':')).replace(/ \d+(\.\d+)?$/, '');
    return lemma === part ? line : `${part} → ${line}`;
  };

  // In order of confidence: the word itself, then its parts, then the spellings DPD's editors point
  // at.
  const row = rowFor(word);
  if (!row) return null;

  const direct = glossLines(row);
  if (direct.length) return direct;

  // A sandhi compound, which DPD answers with the split alone. The split stays as the first line,
  // and each part brings its own glosses in behind it.
  for (const split of asArray(row.deconstructor)) {
    const parts = split.split(' + ').map((part) => scSpelling(part.trim()));
    const lines = [scSpelling(split)];
    for (const part of parts) {
      for (const line of glossLines(rowFor(part))) lines.push(attribute(part, line));
    }
    if (lines.length > 1) return lines;
  }

  // A differently-spelled headword, whose own lemma is displayed so the reader sees where they were
  // sent. `spelling` and `see` are DPD's structured corrections; the variants are prose, so only
  // the readings isVariantOf recognises as this word survive.
  const variants = variantsClosestFirst(word, variantReadings(row));
  for (const candidate of [...asArray(row.spelling), ...asArray(row.see), ...variants]) {
    const lines = glossLines(rowFor(candidate));
    if (lines.length) return lines;
  }
  return null;
}

// Writes data/pli2en_dpd.json from the DPD database and returns what it did, or `{ skipped: true }`
// when no database is named. `force` accepts a shrink beyond MAX_SHRINK.
export function runDictionary({ dbPath = process.env.DPD_DB_PATH || '', force = false } = {}) {
  if (!dbPath) return { skipped: true };
  if (!fs.existsSync(dbPath)) throw new Error(`DPD_DB_PATH does not exist: ${dbPath}`);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let version;
  try {
    version = db.prepare("select value from db_info where key = 'dpd_release_version'").get()?.value || 'unknown';
  } catch {
    throw new Error(
      `${dbPath} is not a DPD database — no db_info table.\n` +
        'Expected the dpd.db.tar.xz asset from https://github.com/digitalpalidictionary/dpd-db/releases'
    );
  }

  const words = corpusWords();
  const entries = [];
  let unresolved = 0;
  for (const word of [...words].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const definition = defineWord(db, word);
    if (definition) entries.push({ entry: word, definition });
    else unresolved += 1;
  }
  db.close();

  // The file being replaced, so the step can report the change and refuse a loss beyond MAX_SHRINK.
  const previous = fs.existsSync(DICT_PATH) ? JSON.parse(fs.readFileSync(DICT_PATH, 'utf8')) : null;
  const previousEntries = Array.isArray(previous?.entries) ? previous.entries.length : null;
  if (previousEntries && entries.length < previousEntries * (1 - MAX_SHRINK) && !force) {
    throw new Error(
      `Refusing to write ${path.basename(DICT_PATH)}: ${entries.length.toLocaleString()} headwords is ` +
        `${(((previousEntries - entries.length) / previousEntries) * 100).toFixed(1)}% fewer than the ` +
        `${previousEntries.toLocaleString()} it replaces (DPD ${previous.dpdVersion || 'unknown'} → ${version}).\n` +
        'Check the database is a full DPD release. To accept the loss anyway: npm run update-data dictionary force'
    );
  }

  fs.writeFileSync(DICT_PATH, `${JSON.stringify({ dpdVersion: version, entries }, null, 2)}\n`);
  return {
    skipped: false,
    dbPath,
    version,
    words: words.size,
    entries: entries.length,
    unresolved,
    previousVersion: previous?.dpdVersion ?? null,
    previousEntries,
    bytes: fs.statSync(DICT_PATH).size,
  };
}
