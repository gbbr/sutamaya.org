import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineWord, dpdSpellings, isVariantOf, variantsClosestFirst } from './update-data-dictionary.mjs';

// The resolution chain is the one piece of this import with real judgement in it: a word is
// answered by its own headwords, else by its parts, else by a spelling DPD points at, else by a
// manuscript variant its editors recorded — and each of those branches is reached only by words
// the corpus happens to contain, so a refresh could stop exercising one without anyone noticing.
// A fixture database is small enough to state the whole shape here and read it as documentation of
// what DPD's tables actually look like.

let dbPath;
let db;
let readonly;

const HEADWORDS = [
  // id, lemma_1, pos, meaning_1, meaning_lit, meaning_2, construction
  [1, 'jhāyati 1.2', 'pr', 'meditates; contemplates', 'thinks', '', 'jhāya + ti'],
  [2, 'ānanda 1', 'masc', 'happiness; joy', '', 'joy, pleasure', 'ā + √nand + a'],
  [3, 'chetvā 1', 'abs', 'having cut off', 'having cut', '', '√chid + *tvā'],
  [4, 'otāriyamāna', 'prp', 'being brought down', '', '', 'ava + √tar'],
  [5, 'saṃyutta', 'pp', 'connected; linked', '', '', 'saṃ + √yuj + ta'],
  // A cross-reference headword: DPD carries these with no meaning at all, and they must not
  // produce an empty line.
  [6, 'jhāyati 9', 'pr', '', '', '', ''],
  [7, 'itisaddo', 'masc', 'the word “iti”', '', '', ''],
  [8, 'dukūlasandana', 'adj', 'with halters made of fine cloth', '', '', ''],
  [9, 'duhasandana', 'adj', 'with milk flowing', '', '', ''],
];

const LOOKUP = [
  // key, headwords, deconstructor, variant, see, spelling
  ['jhāyatha', '[1, 6]', '', '', '', ''],
  ['ānanda', '[2]', '', '', '', ''],
  ['jhāyathānanda', '', '["jhāyatha + ānanda"]', '', '', ''],
  ['chetvā', '[3]', '', '', '', ''],
  ['chetva', '', '', '{"CST": {"SNP": [["anissito chetva", "chetvā (syā. ka.)"]]}}', '', ''],
  ['otāriyamānāni', '[4]', '', '', '', ''],
  ['osāriyamānāni', '', '', '', '', '["otāriyamānāni"]'],
  ['saṃyuttaṃ', '[5]', '', '', '', ''],
  // The variant field is editorial prose, not a reading: "the word iti is absent in the Burmese
  // edition". `itisaddo` is a headword in its own right, and must not become this word's meaning.
  ['ayamidamarahatīti', '', '', '{"SYA": {"DN3": [["samekkhamāno ayamidamarahatīti", "ma. itisaddo na dissati."]]}}', '', ''],
  ['itisaddo', '[7]', '', '', '', ''],
  // Five readings across the editions, in the order DPD stores them: the nearest to what this text
  // spells is the one it means, and it is not the first that resolves.
  ['dukūlasandhanāni', '', '', '{"CST": {"AN9": [["adāsi dukūlasandhanāni", "duhasandanāni (dī. ni. 2.263)"], ["adāsi dukūlasandhanāni", "dukūlasandanāni (tattha pāṭhantaraṃ)"]]}}', '', ''],
  ['dukūlasandanāni', '[8]', '', '', '', ''],
  ['duhasandanāni', '[9]', '', '', '', ''],
  // A row that exists but carries nothing usable — the case that must come back null rather than
  // as an entry with an empty definition.
  ['tvevassa', '', '', '', '', ''],
];

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dpd-')), 'dpd.db');
  db = new DatabaseSync(dbPath);
  db.exec(`
    create table db_info (id integer, key text, value text);
    create table dpd_headwords (id integer, lemma_1 text, pos text, meaning_1 text, meaning_lit text,
      meaning_2 text, construction text);
    create table lookup (lookup_key text primary key, headwords text, deconstructor text,
      variant text, see text, spelling text);
  `);
  db.prepare('insert into db_info values (1, ?, ?)').run('dpd_release_version', 'v0.0.0-test');
  const hw = db.prepare('insert into dpd_headwords values (?, ?, ?, ?, ?, ?, ?)');
  for (const row of HEADWORDS) hw.run(...row);
  const lk = db.prepare('insert into lookup values (?, ?, ?, ?, ?, ?)');
  for (const row of LOOKUP) lk.run(...row);
  readonly = new DatabaseSync(dbPath, { readOnly: true });
});

afterEach(() => {
  readonly.close();
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

const define = (word) => defineWord(readonly, word);

describe('the DPD resolution chain', () => {
  it('renders a word with its own headwords', () => {
    expect(define('jhāyatha')).toEqual(['jhāyati 1.2: pr. <b>meditates; contemplates</b>; lit. thinks [jhāya + ti]']);
  });

  it('skips a headword DPD carries with no meaning', () => {
    expect(define('jhāyatha')).toHaveLength(1);
  });

  it('resolves a sandhi compound to its split plus each part, split first, and only names a part when its lemma differs', () => {
    expect(define('jhāyathānanda')).toEqual([
      'jhāyatha + ānanda',
      'jhāyatha → jhāyati 1.2: pr. <b>meditates; contemplates</b>; lit. thinks [jhāya + ti]',
      'ānanda 1: masc. <b>happiness; joy</b> [ā + √nand + a]',
    ]);
  });

  it('follows a spelling DPD points at', () => {
    expect(define('osāriyamānāni')).toEqual(['otāriyamāna: prp. <b>being brought down</b> [ava + √tar]']);
  });

  it('follows a manuscript variant its editors recorded', () => {
    expect(define('chetva')).toEqual(['chetvā 1: abs. <b>having cut off</b>; lit. having cut [√chid + *tvā]']);
  });

  it('picks the reading nearest what this text spells, not the first one listed', () => {
    expect(define('dukūlasandhanāni')).toEqual(['dukūlasandana: adj. <b>with halters made of fine cloth</b>']);
  });

  it('refuses a word plucked out of an editorial note about the variant', () => {
    expect(define('ayamidamarahatīti')).toBeNull();
  });

  it('answers null for a row with nothing usable, and for a word with no row', () => {
    expect(define('tvevassa')).toBeNull();
    expect(define('nosuchword')).toBeNull();
  });

  it('finds a word this corpus spells with ṁ where DPD keys ṃ, and hands it back in ours', () => {
    expect(define('saṁyuttaṁ')).toEqual(['saṁyutta: pp. <b>connected; linked</b> [saṁ + √yuj + ta]']);
  });
});

describe('isVariantOf', () => {
  it('accepts a scribal respelling and rejects an unrelated word from the same note', () => {
    expect(isVariantOf('chetva', 'chetvā')).toBe(true);
    expect(isVariantOf('osāriyamānāni', 'otāriyamānāni')).toBe(true);
    expect(isVariantOf('athuṇhaṁ', 'atuṇhaṃ')).toBe(true);
    expect(isVariantOf('saṅgāhabalaṁ', 'pāṭho')).toBe(false);
    expect(isVariantOf('ayamidamarahatīti', 'itisaddo')).toBe(false);
    expect(isVariantOf('Tapantamādiccamivantalikkheti', 'saṃ')).toBe(false);
  });
});

describe('variantsClosestFirst', () => {
  it('orders by distance and drops what is not this word at all', () => {
    expect(variantsClosestFirst('dukūlasandhanāni', ['duhasandanāni', 'dukūlasandanāni', 'pāṭhantaraṃ'])).toEqual([
      'dukūlasandanāni',
      'duhasandanāni',
    ]);
  });
});

describe('dpdSpellings', () => {
  it('offers the niggahita and its assimilated forms, original first', () => {
    expect(dpdSpellings('saṁyuttaṁ')).toEqual(['saṁyuttaṁ', 'saṃyuttaṃ']);
    expect(dpdSpellings('evaṅgatikā')).toContain('evaṃgatikā');
    expect(dpdSpellings('khuddaputtañhi')).toContain('khuddaputtaṃhi');
  });
});
