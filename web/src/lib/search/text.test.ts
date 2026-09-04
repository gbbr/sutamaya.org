// The matching, ranking and snippet rules of lib/search/text.ts, over a blob built by hand.
//
// The golden query set (golden.test.ts) runs the same code against the real corpus and says
// whether the results are good; these say which rule broke when they stop being good.
import { describe, expect, it } from 'vitest';
import {
  buildTextIndex,
  searchSuttaText,
  snippetOf,
  RANK_TEXT_PHRASE,
  RANK_TEXT_PARAGRAPH,
  RANK_TEXT_ANYWHERE,
  type SearchMap,
  type TextScore,
} from './text';

const MARK = '\x1e';

// Builds the two blobs the way scripts/build-corpus.mjs does: a marker line opening each sutta and
// each paragraph, one line per segment, the two languages line-aligned.
function index(docs: Array<{ uid: string; paras: Array<Array<[string, string]>> }>) {
  const en: string[] = [];
  const pa: string[] = [];
  const map: SearchMap = [];
  let enChars = 0;
  let paChars = 0;
  const push = (e: string, p: string) => {
    en.push(e);
    pa.push(p);
    enChars += e.length + 1;
    paChars += p.length + 1;
  };
  for (const doc of docs) {
    map.push([doc.uid, enChars, paChars]);
    push(MARK, MARK);
    doc.paras.forEach((para, i) => {
      if (i > 0) push(MARK, MARK);
      for (const [e, p] of para) push(e, p);
    });
  }
  return buildTextIndex(en.join('\n'), pa.join('\n'), map);
}

const one = (segs: Array<[string, string]>) => [segs];

describe('searchSuttaText — matching', () => {
  it('matches an English word whole, and through its plural', () => {
    const X = index([{ uid: 'a', paras: one([['The noble truth of suffering.', '']]) }]);
    expect(searchSuttaText(X, 'truths').has('a')).toBe(true);
    expect(searchSuttaText(X, 'truth').has('a')).toBe(true);
    // Whole words only: "nob" is not a word of it.
    expect(searchSuttaText(X, 'nob').has('a')).toBe(false);
  });

  it('folds diacritics and the curly apostrophe out of the query', () => {
    const X = index([{ uid: 'a', paras: one([['The elephant’s footprint.', 'nibbānaṁ paramaṁ']]) }]);
    expect(searchSuttaText(X, "elephant's footprint").has('a')).toBe(true);
    expect(searchSuttaText(X, 'nibbana').has('a')).toBe(true);
  });

  it('matches Pali as a prefix, so a headword finds its inflections', () => {
    const X = index([{ uid: 'a', paras: one([['', 'satipaṭṭhānaṁ bhāveti']]) }]);
    expect(searchSuttaText(X, 'satipatthana').has('a')).toBe(true);
    // Below four characters a prefix is too broad, so short words match whole.
    const Y = index([{ uid: 'b', paras: one([['', 'nadī gacchati']]) }]);
    expect(searchSuttaText(Y, 'na').has('b')).toBe(false);
  });

  it('does not treat a Pali letter as a word boundary', () => {
    const X = index([{ uid: 'a', paras: one([['', 'mahānibbāna']]) }]);
    expect(searchSuttaText(X, 'nibbana').has('a')).toBe(false);
  });

  it('strips an English plural a reader typed onto a Pali word', () => {
    const X = index([{ uid: 'a', paras: one([['', 'arahanto vuccanti']]) }]);
    expect(searchSuttaText(X, 'arahants').has('a')).toBe(true);
  });

  it('probes the space-joined form of a Pali compound', () => {
    const X = index([{ uid: 'a', paras: one([['', 'mahākassapassa thero']]) }]);
    expect(searchSuttaText(X, 'maha kassapa').has('a')).toBe(true);
  });

  it('requires every word of the query', () => {
    const X = index([{ uid: 'a', paras: one([['Only mindfulness here.', '']]) }]);
    expect(searchSuttaText(X, 'mindfulness breathing').has('a')).toBe(false);
  });
});

describe('searchSuttaText — ranking', () => {
  const X = index([
    // The phrase as typed.
    { uid: 'phrase', paras: one([['a lump of foam drifting', '']]) },
    // Both words, one paragraph, not adjacent.
    { uid: 'para', paras: one([['a lump of drifting sea foam', '']]) },
    // Both words, different paragraphs.
    { uid: 'apart', paras: [[['a lump of clay', '']], [['sea foam', '']]] },
  ]);

  it('ranks the phrase, then the paragraph, then anywhere in the sutta', () => {
    const hits = searchSuttaText(X, 'lump foam');
    expect(hits.get('phrase')?.bucket).toBe(RANK_TEXT_PARAGRAPH);
    expect(hits.get('para')?.bucket).toBe(RANK_TEXT_PARAGRAPH);
    expect(hits.get('apart')?.bucket).toBe(RANK_TEXT_ANYWHERE);
    expect(searchSuttaText(X, 'lump of foam').get('phrase')?.bucket).toBe(RANK_TEXT_PHRASE);
  });

  it('counts the query\'s rarest word, not the sum of all of them', () => {
    const Y = index([
      // "thing" three times over, "radiant" once.
      { uid: 'long', paras: one([['a thing and a thing and a thing that is radiant', '']]) },
      // Both words twice.
      { uid: 'apt', paras: one([['a radiant thing, a radiant thing', '']]) },
    ]);
    const hits = searchSuttaText(Y, 'thing radiant');
    expect(hits.get('long')?.count).toBe(1);
    expect(hits.get('apt')?.count).toBe(2);
  });

  it('drops function words from the required words and from the count', () => {
    const Y = index([
      { uid: 'a', paras: one([['This mind, bhikkhus, is radiant.', '']]) },
      { uid: 'b', paras: one([['It is what it is, and that is that.', '']]) },
    ]);
    const hits = searchSuttaText(Y, 'mind is radiant');
    // "is" is neither required nor counted, so the sutta full of it is not a hit and the one
    // that answers the query is scored on "mind" and "radiant".
    expect(hits.has('b')).toBe(false);
    expect(hits.get('a')?.count).toBe(1);
    // A query with nothing else in it still searches for the function words themselves.
    expect(searchSuttaText(Y, 'is that').has('b')).toBe(true);
  });

  it('does not run a phrase across a paragraph or a sutta boundary', () => {
    const Y = index([
      { uid: 'a', paras: [[['ending in lump', '']], [['foam opening', '']]] },
      { uid: 'b', paras: one([['lump', '']]) },
      { uid: 'c', paras: one([['foam', '']]) },
    ]);
    expect(searchSuttaText(Y, 'lump foam').get('a')?.bucket).toBe(RANK_TEXT_ANYWHERE);
    expect(searchSuttaText(Y, 'lump foam').has('b')).toBe(false);
  });

  it('keeps the English result where both languages answer in the same bucket', () => {
    const Y = index([
      { uid: 'a', paras: one([['The first jhāna.', 'paṭhamaṁ jhānaṁ jhānaṁ jhānaṁ']]) },
      { uid: 'b', paras: one([['The first absorption.', 'paṭhamaṁ jhānaṁ']]) },
    ]);
    // Both languages hold the word, the Pali more often — but a count in one language does not
    // order a result in the other, and the English is what the reader can read.
    expect(searchSuttaText(Y, 'jhana').get('a')?.lang).toBe('en');
    expect(searchSuttaText(Y, 'jhana').get('b')?.lang).toBe('pa');
  });
});

describe('snippetOf', () => {
  // Everything here searches with what the reader typed; the expansion cases pass the two apart.
  const snip = (i: ReturnType<typeof index>, score: TextScore) => snippetOf(i, score, score.query);

  const X = index([
    {
      uid: 'a',
      paras: [
        [['A first paragraph.', 'paṭhamo']],
        [
          ['The mind is radiant.', 'pabhassaraṁ cittaṁ'],
          ['So it is said.', 'iti vuccati'],
        ],
      ],
    },
  ]);

  it('returns the paragraph the query was found in, its segments run together', () => {
    const score = searchSuttaText(X, 'radiant').get('a')!;
    // Segment 1: the sutta's second, the first paragraph holding only segment 0.
    expect(snip(X, score)).toEqual({
      text: 'The mind is radiant. So it is said.',
      query: 'radiant',
      segment: 1,
    });
  });

  it('gives a Pali hit its English underneath', () => {
    const score = searchSuttaText(X, 'pabhassara').get('a')!;
    expect(snip(X, score)).toEqual({
      text: 'pabhassaraṁ cittaṁ iti vuccati',
      under: 'The mind is radiant. So it is said.',
      query: 'pabhassara',
      segment: 1,
    });
  });

  it('names the segment the match is in, not the one the paragraph opens with', () => {
    const Y = index([
      {
        uid: 'a',
        paras: [
          [['One.', '']],
          [
            ['Two.', ''],
            ['Three.', ''],
            ['Radiant four.', ''],
          ],
        ],
      },
    ]);
    expect(snip(Y, searchSuttaText(Y, 'radiant').get('a')!)?.segment).toBe(3);
  });

  it('windows a long paragraph around the match, so the marked word is inside the clamp', () => {
    const filler = 'and so it went on at some length. '.repeat(30);
    const Y = index([{ uid: 'a', paras: one([[`${filler}Then a radiant thing. ${filler}`, '']]) }]);
    const snippet = snip(Y, searchSuttaText(Y, 'radiant').get('a')!)!;
    expect(snippet.text).toContain('radiant');
    expect(snippet.text.length).toBeLessThan(260);
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
  });

  it('keeps the match near the top when it ends the paragraph, rather than filling the window', () => {
    const filler = 'and so it went on at some length. '.repeat(30);
    const Y = index([{ uid: 'a', paras: one([[`${filler}Then a radiant thing.`, '']]) }]);
    const snippet = snip(Y, searchSuttaText(Y, 'radiant').get('a')!)!;
    expect(snippet.text.indexOf('radiant')).toBeLessThan(80);
  });

  it('centres on the phrase, not on a common word that opens the paragraph', () => {
    // "the" is in the first line and in every line; the phrase is far down it.
    const filler = 'and the thing and the other thing. '.repeat(30);
    const Y = index([{ uid: 'a', paras: one([[`${filler}The fires of greed. ${filler}`, '']]) }]);
    const snippet = snip(Y, searchSuttaText(Y, 'the fires of greed').get('a')!)!;
    expect(snippet.text).toContain('fires of greed');
  });

  it('centres on the rarest word when the phrase is not there as typed', () => {
    const filler = 'and the thing and the other thing. '.repeat(30);
    const Y = index([{ uid: 'a', paras: one([[`${filler}A greed of sorts. ${filler}`, '']]) }]);
    const snippet = snip(Y, searchSuttaText(Y, 'the greed').get('a')!)!;
    expect(snippet.text).toContain('greed');
  });

  it('picks the paragraph holding the most of the query\'s words', () => {
    const Y = index([
      {
        uid: 'a',
        paras: [[['mind alone', '']], [['a radiant mind', '']]],
      },
    ]);
    const score = searchSuttaText(Y, 'radiant mind').get('a')!;
    expect(snip(Y, score)?.text).toBe('a radiant mind');
  });

  it('windows the English line on what the reader typed, not on the Pali the expansion found', () => {
    const filler = 'and the thing and the other thing. '.repeat(30);
    const Y = index([
      {
        uid: 'a',
        paras: one([[`${filler}The four noble truths. ${filler}`, 'cattāri ariyasaccāni']]),
      },
    ]);
    const snippet = snippetOf(Y, searchSuttaText(Y, 'ariyasacca').get('a')!, 'noble truths')!;
    expect(snippet.under).toContain('noble truths');
    // Both queries mark: the Pali line carries the one that found the row, the English the typed one.
    expect(snippet.query).toBe('noble truths ariyasacca');
  });
});
