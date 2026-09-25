// The matching, ranking and snippet rules of lib/search/text.ts, over a blob built by hand.
//
// The golden query set (golden.test.ts) runs the same code against the real corpus and says
// whether the results are good; these say which rule broke when they stop being good.
import { describe, expect, it } from 'vitest';
import { SEARCH_RESULTS_CAP } from './metadata';
import {
  buildTextIndex,
  mergeSearchHits,
  passagesOf,
  searchCorpusVariants,
  searchSuttaText,
  searchTextVariants,
  snippetOf,
  windowOnMatch,
  RANK_TEXT_PHRASE,
  RANK_TEXT_PARAGRAPH,
  RANK_TEXT_ANYWHERE,
  type RankedHit,
  type SearchMap,
  type TextScore,
} from './text';
import { runsOf, type Mark } from './match';
import type { Corpus } from '../types';

const MARK = '\x1e';

// The stretches of `text` that `marks` mark, in order — what a reader sees highlighted.
const marked = (text: string, marks: Mark[] = []) => runsOf(text, marks).filter((r) => r.hit).map((r) => r.text);

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

  it('finds a phrase opening inside a match that began mid-word', () => {
    // "sādhu sādhu" first matches from inside "asādhu", which opens no word, and runs over the
    // phrase that does.
    const X = index([{ uid: 'a', paras: one([['', 'asādhu sādhu sādhu']]) }]);
    expect(searchSuttaText(X, 'sadhu sadhu').get('a')?.bucket).toBe(RANK_TEXT_PHRASE);
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

// A search shares one cache of what each pattern found in each blob across the typed query and
// every expansion of it, so a cache that answered for the wrong word — a key colliding across the
// two languages, or across two patterns of the same word — would be invisible to every other test
// here, which reads its results through that same cache.
describe('the scan cache', () => {
  const Y = index([
    { uid: 'a', paras: one([['This mind is radiant.', 'pabhassaramidaṁ cittaṁ']]) },
    { uid: 'b', paras: one([['Thought and thinking.', 'cittaṁ vitakko']]) },
    { uid: 'c', paras: one([['The first absorption.', 'paṭhamaṁ jhānaṁ']]) },
  ]);
  // Queries that reuse each other's words within a language and across the two: "citta" is Pali in
  // one and typed as an English word in another, and "mind" is scanned against both blobs.
  const QUERIES = ['mind', 'citta', 'radiant mind', 'mind citta', 'citta radiant', 'jhana', 'mind'];

  it('answers a query the same as an uncached search, however many ran before it', () => {
    const cold = QUERIES.map((q) => searchSuttaText(Y, q));
    const cache = new Map<string, number[]>();
    expect(QUERIES.map((q) => searchSuttaText(Y, q, cache))).toEqual(cold);
    // The other way round: a cache filled in a different order answers the same.
    const reverse = new Map<string, number[]>();
    const warm = [...QUERIES].reverse().map((q) => searchSuttaText(Y, q, reverse));
    expect(warm).toEqual([...cold].reverse());
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
    // Segments 1 and 2: the sutta's second and third, the first paragraph holding only segment 0.
    expect(snip(X, score)).toEqual({
      text: 'The mind is radiant. So it is said.',
      marks: [[12, 19]],
      segments: [1, 2],
      markedBy: { queries: ['radiant'], anywhere: false },
    });
  });

  it('gives a Pali hit its English underneath', () => {
    const score = searchSuttaText(X, 'pabhassara').get('a')!;
    expect(snip(X, score)).toEqual({
      text: 'pabhassaraṁ cittaṁ iti vuccati',
      marks: [[0, 10]],
      under: 'The mind is radiant. So it is said.',
      underMarks: [],
      segments: [1, 2],
      paliSegments: [1],
      markedBy: { queries: ['pabhassara'], anywhere: false },
    });
  });

  it('names the segments whose Pali holds a mark, and only for a Pali hit', () => {
    const Y = index([
      {
        uid: 'a',
        paras: [
          [['One.', 'eka']],
          [
            ['The mind is radiant.', 'pabhassaraṁ cittaṁ'],
            ['So it is said.', 'iti vuccati'],
            ['Radiant again.', 'puna pabhassaraṁ'],
          ],
        ],
      },
    ]);
    // Not segment 2, which the snippet spans but marks nothing in.
    expect(snip(Y, searchSuttaText(Y, 'pabhassara').get('a')!)?.paliSegments).toEqual([1, 3]);
    expect(snip(Y, searchSuttaText(Y, 'radiant').get('a')!)?.paliSegments).toBeUndefined();
  });

  it('marks only what the search matched: whole English words, and a function word in the phrase alone', () => {
    const Y = index([{ uid: 'a', paras: one([['The fires of greed burn the formless and the other forms.', '']]) }]);
    const snippet = snip(Y, searchSuttaText(Y, 'the fires of greed').get('a')!)!;
    // Not "the" on its own, nor inside "other".
    expect(marked(snippet.text, snippet.marks)).toEqual(['The fires of greed']);
    const forms = snip(Y, searchSuttaText(Y, 'form').get('a')!)!;
    // Not inside "formless": the search matched the word whole, with its plural.
    expect(marked(forms.text, forms.marks)).toEqual(['forms']);
  });

  it('marks Pali where the search matched it: a word opening, and the words run together', () => {
    const Y = index([{ uid: 'a', paras: one([['', 'sampajāno asampajāno mahākassapassa']]) }]);
    const snippet = snip(Y, searchSuttaText(Y, 'sampajan').get('a')!)!;
    expect(marked(snippet.text, snippet.marks)).toEqual(['sampajān']);
    const compound = snip(Y, searchSuttaText(Y, 'maha kassapa').get('a')!)!;
    expect(marked(compound.text, compound.marks)).toEqual(['mahākassapa']);
  });

  it('names the segments its text spans, counted from the sutta rather than the paragraph', () => {
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
    expect(snip(Y, searchSuttaText(Y, 'radiant').get('a')!)?.segments).toEqual([1, 3]);
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
    expect(marked(snippet.text, snippet.marks)).toEqual(['ariyasaccā']);
    expect(marked(snippet.under!, snippet.underMarks)).toEqual(['noble truths']);
  });
});

describe('searchCorpusVariants', () => {
  // Nothing here says "satipatthana" — the expansion table's "establishment of awareness" is the
  // only way in, which is the case the marking rule exists for.
  const corpus: Corpus = {
    nikayas: [],
    suttas: {
      mn10: {
        ref: 'MN 10',
        node: 'x',
        en: 'Mindfulness Meditation',
        pali: 'Kāyagatāsatisutta',
        blurb: 'On the establishment of awareness.',
        min: 20,
      },
    },
    sujatoCommit: 'abc1234',
    dataVersion: 'd1',
    searchVersion: 's1',
    dictionaryVersion: 'k1',
  };

  it('marks the explaining line with the query that found it, function words dropped', () => {
    const [hit] = searchCorpusVariants(corpus, 'satipatthana', {}, [], {});
    expect(hit.explains?.line).toBe('blurb');
    // Both, as a snippet's own query carries both: the typed word marks nothing here, and the row
    // would otherwise show a description with nothing marked in it. "of" is left out — it is in
    // every line, and the matching didn't require it either.
    expect(hit.explains?.query).toBe('satipatthana establishment awareness');
  });
});

describe('mergeSearchHits', () => {
  // One sutta more than the rows drawn, the last saying the query least often, so it ranks last.
  const last = `s${SEARCH_RESULTS_CAP}`;
  const X = index(
    Array.from({ length: SEARCH_RESULTS_CAP + 1 }, (_, i) => ({
      uid: `s${i}`,
      paras: one([[i === SEARCH_RESULTS_CAP ? 'Greed.' : 'Greed and greed.', 'lobho']]),
    }))
  );
  const merge = (readingId?: string) =>
    mergeSearchHits<RankedHit>([], searchTextVariants(X, 'greed'), X, 'greed', (id, rank) => ({ id, rank, saved: false }), readingId);

  it('gives the sutta being read its passages wherever it ranks', () => {
    expect(merge().at(-1)).toMatchObject({ id: last });
    expect(merge().at(-1)?.passages).toBeUndefined();
    expect(merge(last).at(-1)?.passages).toHaveLength(1);
  });

  it('cuts a snippet for the row the sutta being read makes room for among the ones drawn', () => {
    expect(merge().at(-1)?.snippet).toBeUndefined();
    expect(merge('s0').at(-1)?.snippet).toBeDefined();
  });

  it('gives the sutta being read its passages where only a match inside a word finds it', () => {
    const Y = index([{ uid: 'r', paras: one([['Unaware.', 'Asampajāno.']]) }]);
    const text = searchTextVariants(Y, 'sampajan');
    expect(text.size).toBe(0);
    const hits = mergeSearchHits<RankedHit>([], text, Y, 'sampajan', (id, rank) => ({ id, rank, saved: false }), 'r');
    expect(hits).toMatchObject([{ id: 'r', passages: [{ text: 'Asampajāno.', under: 'Unaware.' }] }]);
  });
});

describe('passagesOf', () => {
  const passages = (i: ReturnType<typeof index>, query: string) =>
    passagesOf(i, 0, query, searchSuttaText(i, query).get('a'));

  it('gives each segment holding the query a passage, in reading order, counted past paragraph marks', () => {
    const Y = index([
      {
        uid: 'a',
        paras: [
          [['Greed is a fire.', 'p1'], ['Hatred too.', 'p2']],
          [['Without greed, peace.', 'p3'], ['Greed again.', 'p4']],
        ],
      },
    ]);
    expect(passages(Y, 'greed').map((p) => p.segments)).toEqual([[0, 0], [2, 2], [3, 3]]);
  });

  it('falls back to the one snippet where no segment holds every word', () => {
    const Y = index([{ uid: 'a', paras: one([['Greed is a fire.', 'p1'], ['Hatred too.', 'p2']]) }]);
    expect(passages(Y, 'greed hatred').map((p) => p.segments)).toEqual([[0, 1]]);
  });

  it('gives a Pali passage its English line underneath', () => {
    const Y = index([{ uid: 'a', paras: one([['The mind is radiant.', 'Pabhassaraṁ cittaṁ.']]) }]);
    expect(passages(Y, 'pabhassara')).toMatchObject([{ text: 'Pabhassaraṁ cittaṁ.', under: 'The mind is radiant.' }]);
  });

  it('finds what the expansion table adds, in the English the reader reads', () => {
    const Y = index([{ uid: 'a', paras: [[['Extinguishment.', 'Nibbānaṁ.']], [['Peace.', 'Nibbānaṁ santaṁ.']]] }]);
    expect(passages(Y, 'nibbana').map((p) => [p.text, p.under])).toEqual([
      ['Extinguishment.', undefined],
      ['Nibbānaṁ santaṁ.', 'Peace.'],
    ]);
  });

  it('finds the query inside a longer word, as find-in-page does, and marks it there', () => {
    const Y = index([
      {
        uid: 'a',
        paras: [
          [['Aware.', 'Sampajāno.']],
          [['Unaware.', 'Asampajāno.']],
          [['With awareness.', 'Satisampajaññena.']],
        ],
      },
    ]);
    const found = passages(Y, 'sampajan');
    expect(found.map((p) => p.segments)).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(found.map((p) => marked(p.text, p.marks))).toEqual([['Sampajān'], ['sampajān'], ['sampajañ']]);
    // Where nothing opens a word with it, the search of the whole text finds nothing to fall back on.
    const inside = index([{ uid: 'a', paras: one([['With awareness.', 'Satisampajaññena.']]) }]);
    expect(searchSuttaText(inside, 'sampajan').has('a')).toBe(false);
    expect(passages(inside, 'sampajan')).toHaveLength(1);
  });

  it('marks a plural ending only where it finishes the word', () => {
    const Y = index([{ uid: 'a', paras: one([['Sadness, the noble truths, and classes.', 'p']]) }]);
    const marks = (query: string) => passages(Y, query).flatMap((p) => marked(p.text, p.marks));
    expect(marks('dn')).toEqual(['dn']);
    expect(marks('truth')).toEqual(['truths']);
    expect(marks('class')).toEqual(['classes']);
  });

  it('shows a segment in English where its English holds the query, else in Pali', () => {
    const Y = index([
      {
        uid: 'a',
        paras: [[['The Buddha spoke.', 'Buddho avoca.']], [['So it was said.', 'Buddhena vuttaṁ.']]],
      },
    ]);
    expect(passages(Y, 'buddh').map((p) => [p.text, p.under])).toEqual([
      ['The Buddha spoke.', undefined],
      ['Buddhena vuttaṁ.', 'So it was said.'],
    ]);
    // The line shown in Pali is the one whose Pali opens.
    expect(passages(Y, 'buddh').map((p) => p.paliSegments)).toEqual([undefined, [1]]);
    // Both are marked as they were matched, anywhere, so the reader marks the same.
    expect(passages(Y, 'buddh').map((p) => p.markedBy)).toEqual([
      { queries: ['buddh'], anywhere: true },
      { queries: ['buddh'], anywhere: true },
    ]);
  });

  it('stops one past the cap', () => {
    const lines = Array.from({ length: SEARCH_RESULTS_CAP + 5 }, (): [string, string] => ['Greed.', 'p']);
    expect(passages(index([{ uid: 'a', paras: one(lines) }]), 'greed')).toHaveLength(SEARCH_RESULTS_CAP + 1);
  });
});

describe('windowOnMatch', () => {
  const long = `${'The Buddha teaches the monks at length. '.repeat(6)}At last he speaks of the raft.`;

  it('opens a little before a match deep in the text', () => {
    const cut = windowOnMatch(long, 'raft');
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.indexOf('raft')).toBeLessThan(80);
  });

  it('leaves a short text with an early match whole', () => {
    expect(windowOnMatch('The simile of the raft.', 'raft')).toBe('The simile of the raft.');
  });

  it('leaves the text whole when the query marks nothing in it', () => {
    expect(windowOnMatch(long, 'elephant')).toBe(long);
  });

  it('drops the bold of a note it cuts, wherever the cut falls', () => {
    const note = `Some opening words here. *${'word '.repeat(15).trim()}* and the raft.`;
    expect(windowOnMatch(note, 'raft', true)).toBe(`…${'word '.repeat(10)}and the raft.`);
  });

  it('opens a note no further back than the line above the match, keeping its line breaks', () => {
    const note = 'First line.\nSecond line.\nThird line mentions the raft.\nFourth line.';
    expect(windowOnMatch(note, 'raft', true)).toBe('…Second line.\nThird line mentions the raft.\nFourth line.');
  });

  it('leaves a note whole, bold and all, where the match is on its first two lines, near its start', () => {
    const note = 'A *bold* title\nThe raft is here.\nMore after it.';
    expect(windowOnMatch(note, 'raft', true)).toBe(note);
  });
});
