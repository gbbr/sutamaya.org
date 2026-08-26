import { describe, expect, it } from 'vitest';
import { lookupWord, splitPaliWords, stripPunct } from './dictionary';
import { shardFor, type DictShard } from './dictionaryShards';
// @ts-expect-error -- plain-JS build module, no .d.ts across the workspace boundary
import * as build from '../../../scripts/lib/paliWords.js';

// scripts/lib/paliWords.js is a port of this file's tokenizer and of dictionaryShards.ts's
// shardFor, so build-corpus.mjs can work out which headwords a tap can reach and ship only those.
// If the two ever split a word differently, the build drops entries the reader still asks for and
// the dock reports them as missing — silently, since neither side is wrong on its own terms.
//
// The build's own verification pass replays every tappable word through the shards it wrote, so a
// drift would fail the build too; this catches it at the level of the one function that caused it,
// which is where the fix goes.

// Punctuation, both quote styles, the soft hyphen, em dash and hyphen boundaries, sentence case,
// and the run-on dash forms the corpus actually contains (see WORD_BOUNDARY's comment).
const samples = [
  'jhāyathānanda',
  'Etāni, ānanda, rukkhamūlāni, etāni suññāgārāni, jhāyathānanda, mā pamādattha.',
  '“Evaṁ, bhante”ti.',
  "‘Idappaccayatā’ti—paṭiccasamuppādo.",
  'samudānetabbā—cīvarapiṇḍapātasenāsanagilānappaccayabhesajjaparikkhārā—te',
  'Todeyya-kappā',
  'Bhagavā (arahaṁ) sammāsambuddho…pe…',
  'khīṇanirayomhi',
  'Buddhaṁ saraṇaṁ gacchāmi;',
  'soft­hyphen',
  '   spaced    out\tword  ',
  '',
  '—',
  '-',
];

describe('scripts/lib/paliWords.js matches the reader', () => {
  it('strips the same punctuation', () => {
    for (const s of samples) expect(build.stripPunct(s)).toBe(stripPunct(s));
  });

  it('splits into the same words', () => {
    for (const s of samples) expect(build.splitPaliWords(s)).toEqual(splitPaliWords(s));
  });

  it('agrees on what counts as a word boundary', () => {
    for (const token of ['', ' ', '\t\n', '—', '-', 'a', 'ā', '–']) {
      expect(build.isWordBoundary(token)).toBe(token.trim() === '' || token === '—' || token === '-');
    }
  });

  it('resolves a headword the same way, in both cases', () => {
    const dict = { buddha: ['awakened'], Buddha: ['the Buddha'], ānanda: ['joy'] };
    for (const raw of ['buddha', 'Buddha', 'Buddha,', '“ānanda”', 'nothing']) {
      expect(build.lookupWord(dict, raw)).toEqual(lookupWord(dict, raw));
    }
  });

  it('picks the same shard, including past either end of the manifest', () => {
    const shards: DictShard[] = [
      { file: 'a.json', first: 'ababo', last: 'jhāyati' },
      { file: 'b.json', first: 'jhāyatisu', last: 'saraṇaṁ' },
      { file: 'c.json', first: 'saraṇo', last: 'ṭhena' },
    ];
    for (const key of ['aaa', 'ababo', 'jhāyathānanda', 'jhāyati', 'jhāyatis', 'jhāyatisu', 'saraṇaṁ', 'saraṇan', 'ṭhena', 'ṭhenb', '']) {
      expect(build.shardFor(shards, key)).toEqual(shardFor(shards, key));
    }
  });
});
