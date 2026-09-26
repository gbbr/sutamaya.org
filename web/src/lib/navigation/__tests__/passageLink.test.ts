import { describe, expect, it } from 'vitest';
import { passageFromSearch, passageSearch, type Passage } from '../passageLink';

describe('a passage in a /read link', () => {
  it('reads back as written: its lines, the Pali shown, and every query marking it', () => {
    const passage: Passage = {
      segments: [512, 514],
      paliSegments: [513, 514],
      markedBy: { queries: ['fully extinguished', 'parinibbāna'], anywhere: false },
    };
    const search = passageSearch(passage);

    expect(search).toBe('?at=512-514&pali=513%2C514&q=fully+extinguished&q=parinibb%C4%81na');
    expect(passageFromSearch(search)).toEqual(passage);
  });

  it('names one line as one number', () => {
    expect(passageSearch({ segments: [7, 7] })).toBe('?at=7');
    expect(passageFromSearch('?at=7')).toEqual({ segments: [7, 7] });
  });

  it('is nothing for no passage', () => {
    expect(passageSearch(undefined)).toBe('');
    expect(passageFromSearch('')).toBeUndefined();
    expect(passageFromSearch('?q=dispraise')).toBeUndefined();
  });

  it('ignores lines it cannot read', () => {
    for (const at of ['abc', '5-3', '1-2-3', '-1', '01', '1.5', '']) {
      expect(passageFromSearch(`?at=${at}`)).toBeUndefined();
    }
    expect(passageFromSearch('?at=1-2&pali=x,2,&q=%20')).toEqual({ segments: [1, 2], paliSegments: [2] });
  });
});
