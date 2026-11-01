import { describe, expect, it } from 'vitest';
import { documentSuttas, parseLine, sourcePage, suttasNamed } from '../translations.js';
import { buildBodySegments } from '../collections.js';

describe('suttasNamed', () => {
  it('reads a single sutta, a span and several spans', () => {
    expect(suttasNamed('mn10')).toEqual(['mn10']);
    expect(suttasNamed('sn15.14-17')).toEqual(['sn15.14', 'sn15.15', 'sn15.16', 'sn15.17']);
    expect(suttasNamed('an1.21-23,39-40')).toEqual(['an1.21', 'an1.22', 'an1.23', 'an1.39', 'an1.40']);
    expect(suttasNamed('an1.47,49')).toEqual(['an1.47', 'an1.49']);
  });
});

describe('documentSuttas', () => {
  it('lists the suttas a grouped document holds, its keys named by sutta or by range', () => {
    expect(documentSuttas(['sn12.83:0.1', 'sn12.83:1.1', 'sn12.84:1.1'])).toEqual(['sn12.83', 'sn12.84']);
    expect(documentSuttas(['an10.267-269:1.1', 'an10.267-269:1.2'])).toEqual(['an10.267', 'an10.268', 'an10.269']);
  });
});

describe('sourcePage', () => {
  it("opens SuttaCentral's page for a text copied from sc-data, and the publisher's page otherwise", () => {
    const scData = 'https://github.com/suttacentral/sc-data/blob/main/html_text/en/pli/sutta/sn/sn12/sn12.83-92.html';
    expect(sourcePage(scData, 'bodhi')).toBe('https://suttacentral.net/sn12.83-92/en/bodhi');
    const dhammatalks = 'https://www.dhammatalks.org/suttas/AN/AN3_66.html';
    expect(sourcePage(dhammatalks, 'thanissaro')).toBe(dhammatalks);
  });
});

describe('parseLine', () => {
  const readPath = (href) => (href.endsWith('/an8.46') ? '/read/an8.46?by=bodhi' : null);

  it('returns plain text, with headings and links as offsets into it after trimming', () => {
    const raw = ' <span class="heading">Higher Fetters</span> As in <a href="https://suttacentral.net/an8.46">AN8.46</a>. ';
    expect(parseLine(raw, readPath)).toEqual({
      en: 'Higher Fetters As in AN8.46.',
      headings: [[0, 14]],
      links: [[21, 27, '/read/an8.46?by=bodhi']],
    });
  });

  it('keeps a verse line break, and leaves a link to a text the app lacks as plain text', () => {
    const raw = 'first line\nsecond, see <a href="https://suttacentral.net/pli-tv-kd17">Cv VII</a>';
    expect(parseLine(raw, readPath)).toEqual({ en: 'first line\nsecond, see Cv VII', headings: [], links: [] });
  });

  it('takes a speaker label opening the line out of its text, keeping the offsets after it', () => {
    const raw = ' <p><span class="speaker">Māra:</span> See <a href="https://suttacentral.net/an8.46">AN8.46</a>.</p> ';
    expect(parseLine(raw, readPath)).toEqual({
      en: 'See AN8.46.', speaker: 'Māra:', headings: [], links: [[4, 10, '/read/an8.46?by=bodhi']],
    });
    expect(parseLine(' <span class="speaker">  Māra:</span>\nA verse. ', readPath)).toEqual({
      en: 'A verse.', speaker: 'Māra:', headings: [], links: [],
    });
    expect(parseLine('<p><span class="speaker">Māra:</span></p> <p>A verse.</p> <p>Another.</p>', readPath)).toEqual({
      en: 'A verse. Another.', speaker: 'Māra:', headings: [], links: [],
      blocks: [[0, 8, 'paragraph'], [9, 17, 'paragraph']],
    });
    expect(parseLine('<p><span class="speaker">Māra:</span></p> <p>A verse.</p>', readPath)).toEqual({
      en: 'A verse.', speaker: 'Māra:', headings: [], links: [],
    });
  });

  it('keeps a speaker label later in the line, or alone in it, as offsets', () => {
    expect(parseLine('He reported it. <span class="speaker">Māra:</span>', readPath)).toEqual({
      en: 'He reported it. Māra:', headings: [], speakers: [[16, 21]], links: [],
    });
    expect(parseLine('<span class="speaker">Māra:</span>', readPath)).toEqual({
      en: 'Māra:', headings: [], speakers: [[0, 5]], links: [],
    });
  });

  it('keeps paragraph and bullet offsets over unchanged text, including a linked item', () => {
    const raw = ' <p>First.</p> <ul><li>Second, <a href="https://suttacentral.net/an8.46">AN8.46</a>.</li> <li>Third.</li></ul> <p>Fourth.\nFifth.</p> ';
    const parsed = parseLine(raw, readPath);
    expect(parsed.en).toBe('First. Second, AN8.46. Third. Fourth.\nFifth.');
    expect(parsed.blocks).toEqual([[0, 6, 'paragraph'], [7, 22, 'list-item'], [23, 29, 'list-item'], [30, 44, 'paragraph']]);
    expect(parsed.links).toEqual([[15, 21, '/read/an8.46?by=bodhi']]);
  });

  it.each(['iblock', 'sq-list'])('keeps %s leaf offsets with links over the same plain text', cls => {
    const raw = ` <p>Lead.</p> <div class="${cls}"><p>First, <a href="https://suttacentral.net/an8.46">AN8.46</a>;</p> <p>Second.</p></div> <p>End.</p> `;
    expect(parseLine(raw, readPath)).toEqual({
      en: 'Lead. First, AN8.46; Second. End.', headings: [],
      links: [[13, 19, '/read/an8.46?by=bodhi']],
      blocks: [[0, 5, 'paragraph'], [6, 20, 'indented-item'], [21, 28, 'indented-item'], [29, 33, 'paragraph']],
    });
  });

  it('refuses markup it does not know, or that is unbalanced', () => {
    expect(() => parseLine('a <i>word</i>', readPath)).toThrow(/unexpected markup/);
    expect(() => parseLine('<span class="heading">Title', readPath)).toThrow(/unbalanced/);
    expect(() => parseLine('<span class="speaker">Māra:', readPath)).toThrow(/unbalanced/);
    expect(() => parseLine('<span class="other">Māra:</span>', readPath)).toThrow(/unexpected markup/);
    expect(() => parseLine('<ul><li>Item</ul>', readPath)).toThrow(/unbalanced/);
    expect(() => parseLine('<li>Item</li>', readPath)).toThrow(/nesting/);
    expect(() => parseLine('<p><ul><li>Item</li></ul></p>', readPath)).toThrow(/nesting/);
    expect(() => parseLine('<div class="unknown"><p>Item</p></div>', readPath)).toThrow(/unexpected markup/);
    expect(() => parseLine('<div class="block"><p>Item</p></div>', readPath)).toThrow(/unexpected markup/);
    expect(() => parseLine('<div class="iblock"><p>Item</div>', readPath)).toThrow(/unbalanced/);
    expect(() => parseLine('<div class="iblock"><p><p>Item</p></p></div>', readPath)).toThrow(/nesting/);
    expect(() => parseLine('<div class="sq-list"><ul><li>Item</li></ul></div>', readPath)).toThrow(/nesting/);
  });
});

describe('buildBodySegments over a translator', () => {
  const build = ({ pali, en, html = [], covered = [] }) =>
    buildBodySegments(new Map(pali), new Map(en), new Map(html), new Map(), () => null, new Set(covered));

  it('joins a covered line to the nearest translated line above, across the abbreviated lines between', () => {
    const segs = build({
      pali: [
        ['mn7:5.1', 'A'],
        ['mn7:5.2', 'B'],
        ['mn7:5.3', 'C'],
        ['mn7:5.4', 'D'],
        ['mn7:5.5', 'E'],
      ],
      en: [
        ['mn7:5.1', 'a … and e'],
        ['mn7:5.5', 'next'],
      ],
      html: [['mn7:5.1', '<p>{}']],
      covered: ['mn7:5.4'],
    });
    expect(segs.map((s) => [s.key, s.pali])).toEqual([
      ['mn7:5.1', 'A D'],
      ['mn7:5.5', 'E'],
    ]);
  });

  it('refuses a covered line with no translated line of its sutta above it', () => {
    expect(() => build({ pali: [['sn1.1:1.1', 'A']], en: [], covered: ['sn1.1:1.1'] })).toThrow(/covered\.json/);
  });

  it("takes paragraphs from the Pali's markup, joining a lone line inside a verse", () => {
    const segs = build({
      pali: [
        ['dhp1:1', 'A'],
        ['dhp1:2', 'B'],
        ['dhp1:3', 'C'],
        ['dhp2:1', 'D'],
        ['dhp2:2', 'E'],
      ],
      en: [
        ['dhp1:1', 'a'],
        ['dhp1:3', 'c'],
        ['dhp2:2', 'e'],
      ],
      html: [
        ['dhp1:1', "<blockquote class='gatha'><p><span class='verse-line'>{}</span>"],
        ['dhp1:2', "<span class='verse-line'>{}</span>"],
        ['dhp1:3', "<span class='verse-line'>{}</span></p></blockquote>"],
        ['dhp2:1', "<blockquote class='gatha'><p><span class='verse-line'>{}</span>"],
        ['dhp2:2', "<span class='verse-line'>{}</span></p></blockquote>"],
      ],
    });
    expect(segs.map((s) => [s.key, s.pali])).toEqual([
      ['dhp1:1', 'A B'],
      ['dhp1:3', 'C'],
      ['dhp2:2', 'E'],
    ]);
  });

  it("keeps his headings and links on the segment", () => {
    const [seg] = buildBodySegments(
      new Map([['an4.56:2.1', 'Gāthā']]),
      new Map([['an4.56:2.1', 'The verses are identical with those of <a href="https://suttacentral.net/an4.55">AN4.55</a>.']]),
      new Map(),
      new Map(),
      () => '/read/an4.55?by=bodhi',
      new Set()
    );
    expect(seg).toEqual({
      key: 'an4.56:2.1',
      pali: 'Gāthā',
      en: 'The verses are identical with those of AN4.55.',
      links: [[39, 45, '/read/an4.55?by=bodhi']],
      paragraphEnd: true,
    });
  });

  it('passes block ranges through the corpus build with links and notes intact', () => {
    const [seg] = buildBodySegments(
      new Map([['an8.46:1.1', 'Pali']]),
      new Map([['an8.46:1.1', '<p>See <a href="https://suttacentral.net/an8.46">AN8.46</a>.</p> <ul><li>An item.</li></ul>']]),
      new Map(), new Map([['an8.46:1.1', 'A note.']]), () => '/read/an8.46?by=bodhi', new Set(),
    );
    expect(seg).toEqual({
      key: 'an8.46:1.1', pali: 'Pali', en: 'See AN8.46. An item.', note: 'A note.',
      links: [[4, 10, '/read/an8.46?by=bodhi']], blocks: [[0, 11, 'paragraph'], [12, 20, 'list-item']],
      paragraphEnd: true,
    });
  });

  it('sets a source speaker label above its speech without making the speech a speaker row', () => {
    const [seg] = build({
      pali: [['sn4.24:8.1', 'Pali']],
      en: [['sn4.24:8.1', '<span class="speaker">Mara:</span> “Suppose…”']],
    });
    expect(seg).toEqual({ key: 'sn4.24:8.1', pali: 'Pali', en: '“Suppose…”', speaker: 'Mara:', paragraphEnd: true });
  });

  it('sets a label closing a line above the next line, whose speech it names', () => {
    const segs = build({
      pali: [['mn13:5.1', 'Pali'], ['mn13:6.1', 'Pali']],
      en: [
        ['mn13:5.1', 'They told him what had taken place. <span class="speaker">The Blessed One said:</span>'],
        ['mn13:6.1', '“Bhikkhus, …”'],
      ],
    });
    expect(segs.map(({ key, en, speaker, speakers }) => ({ key, en, speaker, speakers }))).toEqual([
      { key: 'mn13:5.1', en: 'They told him what had taken place.', speaker: undefined, speakers: undefined },
      { key: 'mn13:6.1', en: '“Bhikkhus, …”', speaker: 'The Blessed One said:', speakers: undefined },
    ]);
  });

  it('keeps a label closing a sutta’s last line in place', () => {
    const [seg] = build({
      pali: [['mn13:5.1', 'Pali']],
      en: [['mn13:5.1', 'They told him. <span class="speaker">The Blessed One said:</span>']],
    });
    expect(seg.en).toBe('They told him. The Blessed One said:');
    expect(seg.speakers).toEqual([[15, 36]]);
  });

  it('sets a label after the quotation mark opening its paragraph above the line, mark and all', () => {
    const [seg] = build({
      pali: [['an3.15:4.1', 'Pali']],
      en: [['an3.15:4.1', '“<span class="speaker">The king asked:</span> ‘Why is it?’']],
    });
    expect(seg.speaker).toBe('“The king asked:');
    expect(seg.en).toBe('‘Why is it?’');
  });
});
