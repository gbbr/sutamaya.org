import { describe, expect, it } from 'vitest';
import { searchKey } from './corpus';
import { matchRuns } from './searchMatch';

// The marked stretches only, in order — what a reader actually sees highlighted.
const marks = (text: string, query: string) => matchRuns(text, query).filter((r) => r.hit).map((r) => r.text);
// Runs must always reassemble into exactly the string handed in, whatever was marked.
const whole = (text: string, query: string) => matchRuns(text, query).map((r) => r.text).join('');

describe('matchRuns', () => {
  it('marks each word of the query wherever it appears', () => {
    expect(marks('The Establishment of Mindfulness', 'mindfulness establishment')).toEqual(['Establishment', 'Mindfulness']);
  });

  it('marks a match that differs from the query by its diacritics, without disturbing them', () => {
    expect(marks('Satipaṭṭhānasutta', 'satipatthana')).toEqual(['Satipaṭṭhāna']);
    expect(whole('Satipaṭṭhānasutta', 'satipatthana')).toBe('Satipaṭṭhānasutta');
  });

  it('keeps a combining mark with the letter it belongs to when the match ends on it', () => {
    expect(marks('Mūlapariyāya', 'mu')).toEqual(['Mū']);
  });

  it('marks consecutive matched words as one stretch, spaces and all', () => {
    // Not "four" | " " | "noble" | " " | "truths": the phrase is in the text whole, and marking it
    // in pieces punches unmarked gaps through it.
    expect(marks('The four noble truths', 'four noble truths')).toEqual(['four noble truths']);
    // Only where they really are consecutive — a word between them is not swept in.
    expect(marks('four of the noble truths', 'four noble')).toEqual(['four', 'noble']);
  });

  it('merges overlapping and adjacent matches into one mark', () => {
    expect(marks('Mindfulness', 'mind mindful')).toEqual(['Mindful']);
    expect(marks('Mindfulness', 'mind fulness')).toEqual(['Mindfulness']);
  });

  it('marks the singular of a typed plural, which is what search matched', () => {
    expect(marks('the noble truth of suffering', 'noble truths')).toEqual(['noble truth']);
    // A short word keeps its "s": "is" is not a plural of "i".
    expect(marks('It is so', 'is')).toEqual(['is']);
  });

  it('marks every occurrence, not just the first', () => {
    expect(marks('Mind over mind', 'mind')).toEqual(['Mind', 'mind']);
  });

  it('returns the text untouched when this field holds none of the words', () => {
    // A hit can match on its blurb alone, leaving its title with nothing to mark.
    expect(matchRuns('The Root of All Things', 'apple')).toEqual([{ text: 'The Root of All Things', hit: false }]);
  });

  it('returns the text untouched for an empty or blank query', () => {
    expect(matchRuns('The Root of All Things', '')).toEqual([{ text: 'The Root of All Things', hit: false }]);
    expect(matchRuns('The Root of All Things', '   ')).toEqual([{ text: 'The Root of All Things', hit: false }]);
    expect(matchRuns('', 'root')).toEqual([{ text: '', hit: false }]);
  });

  it('reassembles into the original string in every case', () => {
    for (const text of ['Satipaṭṭhānasutta', 'The Root of All Things', 'Dhp320–333', 'Mūlapariyāyasutta', '']) {
      for (const query of ['a', 'the root', 'satipatthana', 'ṭṭhāna', 'nothing here', '']) {
        expect(whole(text, query)).toBe(text);
      }
    }
  });

  // matchRuns folds one character at a time so it can map a match back to the text on screen;
  // searchCorpus folds the whole string at once. They must agree, or a row would be marked
  // somewhere other than where the match was found — or not marked at all.
  it('folds text the same way searchCorpus matches it', () => {
    // Searching a string for its own folded self marks all of it, consecutive words included —
    // except where something the query never had, such as "·", separates two of them.
    for (const text of ['Satipaṭṭhānasutta', 'MN10 · Mūlapariyāya', 'ÄÖÜ ñ ṁ ḷ', 'Dhp320–333', "a note with 'quotes' & symbols"]) {
      expect(marks(text, searchKey(text)).join(' ')).toBe(text);
    }
  });
});
