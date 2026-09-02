import { describe, expect, it } from 'vitest';
import { indexTerm } from './update-data/index-terms.mjs';
import { resolveCitation } from './update-data-index.mjs';

describe('resolveCitation', () => {
  const uids = new Set(['mn21', 'dhp179-196', 'an1.82-97', 'sn35.180-182']);
  const ranges = new Map([
    ['dhp179-196', { prefix: 'dhp', start: 179, end: 196 }],
    ['an1.82-97', { prefix: 'an1.', start: 82, end: 97 }],
    ['sn35.180-182', { prefix: 'sn35.', start: 180, end: 182 }],
  ]);
  const resolve = (citation) => resolveCitation(citation, uids, ranges);

  it('resolves a citation naming a document this corpus ships, segment reference and all', () => {
    expect(resolve('MN21')).toBe('mn21');
    expect(resolve('MN21:2.3.1')).toBe('mn21');
  });

  it('resolves a citation naming one sutta inside a batched document', () => {
    expect(resolve('Dhp183')).toBe('dhp179-196');
    expect(resolve('AN1.90')).toBe('an1.82-97');
  });

  it('respects a range\'s own prefix, not just the numeric overlap', () => {
    expect(resolve('AN35.181')).toBeNull();
    expect(resolve('SN35.181')).toBe('sn35.180-182');
  });

  it('resolves nothing for a collection this corpus does not carry, or for CIPS\'s own rows', () => {
    expect(resolve('Kp5')).toBeNull();
    expect(resolve('Vv1.1')).toBeNull();
    expect(resolve('CUSTOM_something')).toBeNull();
    expect(resolve('')).toBeNull();
  });
});

describe('indexTerm', () => {
  it('rewords a headword into the app\'s English and keeps CIPS\'s wording as an alias', () => {
    expect(indexTerm('right concentration (sammā samādhi)')).toEqual({
      label: 'right composure (sammā samādhi)',
      alias: 'right concentration (sammā samādhi)',
    });
  });

  it('leaves a headword the app words the same way alone', () => {
    expect(indexTerm('jealousy (issā)')).toEqual({ label: 'jealousy (issā)', alias: '' });
  });

  it('rewrites at word boundaries, so "monk" leaves "monkey" alone', () => {
    expect(indexTerm('monkey').label).toBe('monkey');
    expect(indexTerm('group of five monks (pañcavaggiyā bhikkhū)').label).toBe(
      'group of five bhikkhus (pañcavaggiyā bhikkhū)'
    );
  });

  it('takes the longest phrase, not the words inside it', () => {
    expect(indexTerm('placing of the mind and keeping it connected (vitakkavicārā)').label).toBe(
      'thought and examination (vitakkavicārā)'
    );
  });

  it('rewrites "origin" only in the headwords named, leaving dependent origination', () => {
    expect(indexTerm('origination (samudaya)').label).toBe('arising (samudaya)');
    expect(indexTerm('dependent origination').label).toBe('dependent origination');
  });
});
