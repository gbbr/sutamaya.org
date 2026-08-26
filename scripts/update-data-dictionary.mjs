// Rebuilds data/pli2en_dpd.json from a Digital Pali Dictionary release database.
//
// Optional, and off unless DPD_DB_PATH names a dpd.db: the generated file is checked in, so a
// clone without the database builds from it unchanged. Get one from
// https://github.com/digitalpalidictionary/dpd-db/releases (the dpd.db.tar.xz asset).
//
// What comes out is not DPD. It is only the headwords a tap in *this* corpus can reach, and per
// headword only the gloss lines the reader's dictionary dock renders — no examples, citations,
// frequencies, inflection tables or other scripts. That is what keeps a ~2.3GB database down to a
// file the app can ship, and it is why the import scans data/pali/ rather than taking the
// dictionary whole.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { splitPaliWords, stripPunct } from './lib/paliWords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const PALI = path.join(DATA, 'pali');
export const DICT_PATH = path.join(DATA, 'pli2en_dpd.json');

// SuttaCentral writes the niggahita as ṁ, and writes it assimilated as ṅ before a velar and ñ
// before h; DPD keys all of them as ṃ. The two projects spell the same word differently — this is
// orthographic conversion, not a search for a word that might be close enough, which is why the
// candidates are tried as spellings of the tapped word rather than scored against it.
export function dpdSpellings(word) {
  const niggahita = word.replace(/ṁ/g, 'ṃ');
  return [...new Set([word, niggahita, niggahita.replace(/ṅ(?=[kg])/g, 'ṃ'), niggahita.replace(/ñ(?=h)/g, 'ṃ')])];
}

// The reverse, for anything DPD hands back that gets displayed: the dock sits beside the sutta, and
// a lemma spelled ṃ next to a text spelled ṁ reads as a different word.
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

// A manuscript variant is the same word spelled another way, and that is the whole test a candidate
// reading has to pass. It matters because DPD's `variant` field is free-form editorial prose in
// abbreviated Pali — "ma. itisaddo na dissati." ("the word iti is absent in the Burmese edition"),
// "saṅgahabalantipi pāṭho." ("saṅgahabalaṁ is also read") — and any word in a sentence like that
// can happen to be a headword in its own right. Without this, `ayamidamarahatīti` is defined as
// "itisaddo" and `saṅgāhabalaṁ` as "pāṭho" ("a reading"), each perfectly confidently.
export const isVariantOf = (word, candidate) =>
  editDistance(niggahita(word), niggahita(candidate)) <= Math.max(2, Math.round(niggahita(word).length * 0.3));

// Closest first, because a word often has several readings across the editions and they are stored
// in no useful order. AN 9.20's `dukūlasandhanāni` lists five, of which `duhasandanāni` ("with milk
// flowing") sits above `dukūlasandanāni` ("with halters of fine cloth") — and only the latter is
// the word this text is spelling, as its own English says. Nearest reading wins.
export const variantsClosestFirst = (word, candidates) =>
  candidates
    .filter((candidate) => isVariantOf(word, candidate))
    .sort((a, b) => editDistance(niggahita(word), niggahita(a)) - editDistance(niggahita(word), niggahita(b)));

// Every Pali word in the source data — a superset of what the reader can tap, since build-corpus
// emits a subset of these segments and trims the dictionary again to exactly what it emitted.
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

// How far the headword count may fall before the import refuses to write. A new DPD release moving
// a few hundred words either way is ordinary; losing a tenth of the dictionary means something is
// wrong with the database or with this script, and overwriting a good file with it is the one
// failure here that a later build cannot detect — build-corpus verifies the shards against this
// file, so a diminished file verifies perfectly.
const MAX_SHRINK = 0.1;

// Prepared once per database rather than per word: the import asks these two questions a few
// hundred thousand times, and re-preparing them each time is most of the run.
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

// Definitions for one word as the dock will render them, or null when nothing in DPD glosses it.
// Exported for its own test: this is where all the judgement in the import lives.
export function defineWord(db, word) {
  const { lookupRow, headword } = statements(db);

  const rowFor = (candidate) => {
    for (const spelling of dpdSpellings(candidate)) {
      const row = lookupRow.get(spelling) || lookupRow.get(spelling.toLowerCase());
      if (row) return row;
    }
    return null;
  };

  // One rendered definition, in the shape the dock already displays: lemma, part of speech, the
  // meaning in bold, then the literal reading and the word's construction. A headword with no
  // meaning at all (DPD carries some as pure cross-references) contributes nothing.
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

  // DPD records a manuscript variant as {edition: {text: [[context, "reading (sigla)"]]}} — the
  // editions disagreeing about a word this corpus happens to spell the losing way. A reading is
  // accepted only when it is itself a glossed headword, so what gets shown is DPD's own alternative
  // rather than a spelling this script talked itself into.
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

  // A part's gloss is attributed to the part it came from, so a five-part compound doesn't read as
  // one word with fifteen meanings. Not when the lemma is that same word already, though —
  // "ānanda → ānanda 1: masc. …" points at itself, and the arrow only adds width.
  const attribute = (part, line) => {
    const lemma = line.slice(0, line.indexOf(':')).replace(/ \d+(\.\d+)?$/, '');
    return lemma === part ? line : `${part} → ${line}`;
  };

  // The order is the order of confidence: the word itself, then its parts, then the spellings
  // DPD's own editors point at.
  const row = rowFor(word);
  if (!row) return null;

  const direct = glossLines(row);
  if (direct.length) return direct;

  // A sandhi compound. DPD answers with the split alone, which on its own renders as a line of
  // Pali and no meaning — the reason this import exists at all. The split stays as the first
  // line, since it is the word's structure, and each part brings its own glosses in behind it.
  for (const split of asArray(row.deconstructor)) {
    const parts = split.split(' + ').map((part) => scSpelling(part.trim()));
    const lines = [scSpelling(split)];
    for (const part of parts) {
      for (const line of glossLines(rowFor(part))) lines.push(attribute(part, line));
    }
    if (lines.length > 1) return lines;
  }

  // A spelling DPD holds as a misspelling or a cross-reference of another, and then the manuscript
  // variants. Both resolve to a differently-spelled headword whose own lemma is displayed, so the
  // reader can see which word they were sent to. `spelling` and `see` are structured corrections
  // and stand as they are; the variants are prose, and only the readings that are recognisably
  // this word survive isVariantOf.
  const variants = variantsClosestFirst(word, variantReadings(row));
  for (const candidate of [...asArray(row.spelling), ...asArray(row.see), ...variants]) {
    const lines = glossLines(rowFor(candidate));
    if (lines.length) return lines;
  }
  return null;
}

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

  // What this replaces, so the step can say whether it was a gain or a loss, and refuse the
  // losses that can only be a mistake. A count on its own answers neither question anyone actually
  // has about a regenerated file.
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
