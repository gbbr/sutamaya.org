import { describe, expect, it } from 'vitest';
import { passageFromSearch, readLink, type Passage } from '../passageLink';

describe('a passage in a /read link', () => {
  it('reads back as written: its lines, the Pali shown, and every query marking it', () => {
    const passage: Passage = {
      segments: ['dn16:6.8.1', 'dn16:6.8.3'],
      paliSegments: ['dn16:6.8.2', 'dn16:6.8.3'],
      markedBy: { queries: ['fully extinguished', 'parinibbāna'], anywhere: false },
    };
    const link = readLink('dn16', passage);

    expect(link).toBe('/read/dn16?at=6.8.1-6.8.3&pali=6.8.2%2C6.8.3&q=fully+extinguished&q=parinibb%C4%81na');
    expect(passageFromSearch(link.slice(link.indexOf('?')), 'dn16')).toEqual(passage);
  });

  it('names one line by what follows its colon', () => {
    expect(readLink('sn46.53', { segments: ['sn46.53:15.4', 'sn46.53:15.4'] })).toBe('/read/sn46.53?at=15.4');
    expect(passageFromSearch('?at=15.4', 'sn46.53')).toEqual({ segments: ['sn46.53:15.4', 'sn46.53:15.4'] });
  });

  it('names the inner sutta of a batch its lines belong to', () => {
    expect(readLink('an1.1-10', { segments: ['an1.5:1.1', 'an1.5:1.2'] })).toBe('/read/an1.5?at=1.1-1.2');
    expect(passageFromSearch('?at=1.1-1.2', 'an1.5')).toEqual({ segments: ['an1.5:1.1', 'an1.5:1.2'] });
  });

  it('is the bare sutta for no passage', () => {
    expect(readLink('mn10', undefined)).toBe('/read/mn10');
    expect(passageFromSearch('', 'mn10')).toBeUndefined();
    expect(passageFromSearch('?q=dispraise', 'mn10')).toBeUndefined();
  });

  it('ignores lines it cannot read', () => {
    for (const at of ['abc', '1-2-3', '-1', '1.', '.5', '1:2', '']) {
      expect(passageFromSearch(`?at=${at}`, 'mn10')).toBeUndefined();
    }
    expect(passageFromSearch('?at=1.1-1.2&pali=x,1.2,&q=%20', 'mn10')).toEqual({
      segments: ['mn10:1.1', 'mn10:1.2'],
      paliSegments: ['mn10:1.2'],
    });
  });
});
