import { describe, expect, it } from 'vitest';
import { citations, cleanHtml, nameKey, naturalOrder } from '../update-data-names.mjs';

// Reading the dictionary's citations is where the import's judgement sits: a citation it misses
// drops a person the suttas mention, and one it invents keeps a person they don't.

describe('citations', () => {
  it('reads the four nikāyas by volume and page', () => {
    expect(citations('preached the Mahā Sīhanādasutta (MN.i.68ff.; SN.iv.282)')).toEqual(['mn 1.68', 'sn 4.282']);
  });

  it('reads sutta numbers, inside a group or out', () => {
    expect(citations('see MN 105 and SN 11.8, also AN 1.32')).toEqual(['mn105', 'sn11.8', 'an1.32']);
  });

  it('reads the verse books by verse, verse range or page', () => {
    expect(citations('Thag.vv.121-2; Thag.868-70; Snp.v.835; Snp.p.123; Dhp.vs.241f.')).toEqual([
      'thag v121',
      'thag v868',
      'snp v835',
      'snp p123',
      'dhp v241',
    ]);
  });

  it('reads the Udāna by chapter and sutta, and by page', () => {
    expect(citations('Ud.iv.3; Ud.13')).toEqual(['ud4.3', 'ud p13']);
  });

  it('leaves out the commentaries and other books', () => {
    expect(citations('SN-a.i.240ff; Dhp-a.ii.74f; Thag-a.ii.123; Vin.ii.154; Ja.i.41; Bv.xx.28')).toEqual([]);
  });

  it('does not read ordinary words as books', () => {
    expect(citations('It is said that the Itivuttaka records it.')).toEqual([]);
  });
});

describe('cleanHtml', () => {
  it('keeps paragraphs, lists, bold and italic, and drops every attribute and other tag', () => {
    expect(cleanHtml('<p class="x">A <b>Licchavī</b> (<i>anibaddha</i>) <Abbr Title="Added">MN 105</Abbr>.</p><script>x</script>')).toBe(
      '<p>A <b>Licchavī</b> (<i>anibaddha</i>) MN 105.</p>x'
    );
  });
});

describe('nameKey', () => {
  it('gives the spellings of one name one key', () => {
    expect(nameKey('Nāḷandā')).toBe(nameKey('Nālandā'));
    expect(nameKey('Mahā Kassapa')).toBe(nameKey('mahākassapa'));
    expect(nameKey('saṃyutta')).toBe(nameKey('saṁyutta'));
  });
});

describe('naturalOrder', () => {
  it('orders sutta ids as the canon runs', () => {
    expect(['sn1.10', 'sn1.9', 'an1.21-40', 'an1.1-10'].sort(naturalOrder)).toEqual(['an1.1-10', 'an1.21-40', 'sn1.9', 'sn1.10']);
  });
});
