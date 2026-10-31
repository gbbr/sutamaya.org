import { describe, expect, it } from 'vitest';
import { addDefinitions } from '../dictionaryAdditions.js';

const GOENKA = { headword: 'sampajāna', source: 'Goenka', meaning: 'with constant thorough understanding' };

describe('addDefinitions', () => {
  it('follows the last of the headword’s homonyms', () => {
    const dict = {
      sampajāno: ['sampajāna 1: adj. <b>clearly aware</b>', 'sampajāna 2: adj. <b>deliberate</b>'],
    };
    expect(addDefinitions(dict, [GOENKA])).toEqual([]);
    expect(dict.sampajāno).toEqual([
      'sampajāna 1: adj. <b>clearly aware</b>',
      'sampajāna 2: adj. <b>deliberate</b>',
      'sampajāna: (Goenka) <b>with constant thorough understanding</b>',
    ]);
  });

  it('carries the compound part it explains, before the next part', () => {
    const dict = {
      sampajānohaṁ: [
        'sampajāno + ahaṁ',
        'sampajāno → sampajāna 1: adj. <b>clearly aware</b>',
        'ahaṁ: pron. <b>I</b>',
      ],
    };
    addDefinitions(dict, [GOENKA]);
    expect(dict.sampajānohaṁ).toEqual([
      'sampajāno + ahaṁ',
      'sampajāno → sampajāna 1: adj. <b>clearly aware</b>',
      'sampajāno → sampajāna: (Goenka) <b>with constant thorough understanding</b>',
      'ahaṁ: pron. <b>I</b>',
    ]);
  });

  it('leaves other words alone and returns an addition no entry defines', () => {
    const dict = { asampajāno: ['asampajāna: adj. <b>unaware</b>'] };
    expect(addDefinitions(dict, [GOENKA])).toEqual([GOENKA]);
    expect(dict.asampajāno).toEqual(['asampajāna: adj. <b>unaware</b>']);
  });
});
