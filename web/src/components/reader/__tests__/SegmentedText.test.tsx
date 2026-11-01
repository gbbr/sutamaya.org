import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SegmentedText, type SegmentMarks } from '../SegmentedText';
import type { SegmentFile } from '../../../lib/corpus/corpus';
import type { Highlight, ThemeColors } from '../../../lib/types';

const theme: ThemeColors = { bg: '#fff', fg: '#000', dim: '#888', rule: '#ccc', panel: '#fff', pali: '#333', tint: '#eee', paliTint: '#e8dcc8', focusTint: '#f5f5f5', highlightPalette: null, selection: '#ddd' };

function baseProps(segments: SegmentFile[], overrides: Partial<Parameters<typeof SegmentedText>[0]> = {}) {
  return {
    segments,
    highlights: [],
    theme,
    fontSize: 18,
    lineHeight: 150,
    face: 'serif',
    openSegs: { 0: true },
    allPali: false,
    paliAbove: false,
    onToggleSeg: vi.fn(),
    onWordClick: vi.fn(),
    onTextUp: vi.fn(),
    onSpanClick: vi.fn(),
    showNotes: false,
    openNotes: {},
    onToggleNote: vi.fn(),
    onNoteLink: vi.fn(),
    onNoteLinkPress: vi.fn(),
    activeWord: null,
    onSegmentNumber: vi.fn(),
    ...overrides,
  };
}

describe('SegmentedText — links in a translator note', () => {
  const segments: SegmentFile[] = [
    { key: 'mn10:1.1', pali: 'Evaṁ me sutaṁ', en: 'So I have heard.', note: 'Compare <a href="/read/sn46.53?at=15.4">SN 46.53:15.4</a>.' },
  ];
  const noteLink = (container: HTMLElement) => container.querySelector('[data-reveal="note"] a')!;

  it('hands a tapped link to the reader rather than navigating', () => {
    const onNoteLink = vi.fn();
    const { container } = render(<SegmentedText {...baseProps(segments, { showNotes: true, openNotes: { 0: true }, onNoteLink })} />);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    noteLink(container).dispatchEvent(click);
    expect(onNoteLink).toHaveBeenCalledWith('/read/sn46.53?at=15.4');
    expect(click.defaultPrevented).toBe(true);
  });

  it('hands a link to the reader as it is pressed, before the tap completes', () => {
    const onNoteLinkPress = vi.fn();
    const { container } = render(<SegmentedText {...baseProps(segments, { showNotes: true, openNotes: { 0: true }, onNoteLinkPress })} />);
    fireEvent.pointerDown(noteLink(container));
    expect(onNoteLinkPress).toHaveBeenCalledWith('/read/sn46.53?at=15.4');
  });

  it('leaves a modified click to the browser, for a new tab', () => {
    const onNoteLink = vi.fn();
    const { container } = render(<SegmentedText {...baseProps(segments, { showNotes: true, openNotes: { 0: true }, onNoteLink })} />);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    noteLink(container).dispatchEvent(click);
    expect(onNoteLink).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
  });
});

describe('SegmentedText — translator note numbers', () => {
  const segments: SegmentFile[] = [
    { key: 'mn10:1.1', pali: 'Evaṁ me sutaṁ', en: 'So I have heard.', note: 'First.' },
    { key: 'mn10:1.2', pali: 'ekaṁ samayaṁ', en: 'At one time' },
    { key: 'mn10:1.3', pali: 'bhagavā', en: 'the Buddha', note: 'Second.' },
  ];

  it('numbers the notes through the sutta and opens each with its number', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { showNotes: true, openNotes: { 2: true } })} />);
    expect([...container.querySelectorAll('[data-seg] sup')].map((el) => el.textContent)).toEqual(['1', '2']);
    expect(container.querySelector('[data-reveal="note"]')!.textContent).toBe('2Second.');
  });
});

// Regression coverage for a real bug: SuttaCentral joins some Pali words with a bare "—" (em
// dash), no surrounding space (e.g. MN17's "samudānetabbā—cīvara...parikkhārā—te", three separate
// dictionary words). Clicking that run used to look up the whole thing as one mangled word.
describe('SegmentedText — em-dash-joined Pali words', () => {
  const dashJoined = 'samudānetabbā—cīvarapiṇḍapātasenāsanagilānappaccayabhesajjaparikkhārā—te';
  const segments: SegmentFile[] = [{ key: 'mn17:26.6', pali: dashJoined, en: 'placeholder' }];

  it('renders each dash-separated piece as its own clickable word, not one run-on token', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const words = [...container.querySelectorAll('.pw')].map((el) => el.textContent);
    expect(words).toEqual(['samudānetabbā', 'cīvarapiṇḍapātasenāsanagilānappaccayabhesajjaparikkhārā', 'te']);
  });

  it('clicking the first piece reports only that word, with word index 0', () => {
    const onWordClick = vi.fn();
    const { container } = render(<SegmentedText {...baseProps(segments, { onWordClick })} />);
    const [first] = container.querySelectorAll('.pw');
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onWordClick).toHaveBeenCalledWith('samudānetabbā', 0, 0);
  });

  it('clicking the middle piece reports only that word, not the concatenation of all three', () => {
    const onWordClick = vi.fn();
    const { container } = render(<SegmentedText {...baseProps(segments, { onWordClick })} />);
    const [, middle] = container.querySelectorAll('.pw');
    middle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onWordClick).toHaveBeenCalledWith('cīvarapiṇḍapātasenāsanagilānappaccayabhesajjaparikkhārā', 0, 1);
  });

  it('clicking the last piece reports only that word, with word index 2', () => {
    const onWordClick = vi.fn();
    const { container } = render(<SegmentedText {...baseProps(segments, { onWordClick })} />);
    const [, , last] = container.querySelectorAll('.pw');
    last.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onWordClick).toHaveBeenCalledWith('te', 0, 2);
  });

  it('the "—" itself is rendered as visible text but is not a clickable .pw word', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    expect(container.querySelector('[data-seg="0"]')?.parentElement?.textContent).toContain('—');
    expect([...container.querySelectorAll('.pw')].some((el) => el.textContent === '—')).toBe(false);
  });
});

// Same bug class as the em-dash case above, found by scanning the corpus for other problematic
// separators: a handful of suttas join two words with a bare regular hyphen instead.
describe('SegmentedText — hyphen-joined Pali words', () => {
  const hyphenJoined = 'Todeyya-kappā';
  const segments: SegmentFile[] = [{ key: 'dn23:1.1', pali: hyphenJoined, en: 'placeholder' }];

  it('renders each hyphen-separated piece as its own clickable word', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const words = [...container.querySelectorAll('.pw')].map((el) => el.textContent);
    expect(words).toEqual(['Todeyya', 'kappā']);
  });

  it('the "-" itself is rendered as visible text but is not a clickable .pw word', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    expect(container.querySelector('[data-seg="0"]')?.parentElement?.textContent).toContain('-');
    expect([...container.querySelectorAll('.pw')].some((el) => el.textContent === '-')).toBe(false);
  });
});

// Regression coverage for a real bug: a batched leaf document (several inner suttas in one file,
// e.g. "dhp320-333") numbers each inner sutta's lines flatly with no dot ("dhp320:1" … "dhp320:4",
// then resetting to "dhp321:1" …) — paragraphOf() used to key only off that trailing digit, so
// consecutive lines within one verse (different digits) looked like separate paragraphs while the
// boundary between two different verses (digits that happen to coincide) could collapse into one,
// making a whole batch of verses render as one undifferentiated block instead of distinct stanzas.
describe('SegmentedText — verse-group breaks in a batched document', () => {
  const segments: SegmentFile[] = [
    { key: 'dhp320:1', pali: 'a', en: 'a', role: 'verse' },
    { key: 'dhp320:2', pali: 'b', en: 'b', role: 'verse' },
    { key: 'dhp321:1', pali: 'c', en: 'c', role: 'verse' },
  ];

  it('keeps lines of the same inner verse together, with no gap between them', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const row = container.querySelector('#dhp320\\:1') as HTMLElement;
    expect(row.style.marginBottom).toBe('0px');
  });

  it('inserts a real gap at the boundary into the next inner verse', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const row = container.querySelector('#dhp320\\:2') as HTMLElement;
    expect(row.style.marginBottom).not.toBe('0px');
    expect(row.style.marginBottom).not.toBe('');
  });
});

describe('SegmentedText — printed paragraphs', () => {
  it('breaks where the markup ends a paragraph, not where the segment numbers change', () => {
    const segments: SegmentFile[] = [
      { key: 'dn11:1.1', pali: 'a', en: 'a', pe: 1 },
      { key: 'dn11:1.2', pali: 'b', en: 'b' },
      { key: 'dn11:2.1', pali: 'c', en: 'c', pe: 1 },
    ];
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const gapBelow = (key: string) => (container.querySelector(`[id="${key}"]`) as HTMLElement).style.marginBottom;
    expect(gapBelow('dn11:1.1')).not.toBe('0px');
    expect(gapBelow('dn11:1.2')).toBe('0px');
  });

  it('rules a verse line’s verse alone, leaving his paragraph after it as prose', () => {
    const en = 'I weary myself with Gotama.” Then Māra left.';
    const segments: SegmentFile[] = [{ key: 'sn4.24:10.4', pali: 'Pali', en, role: 'verse', blocks: [[29, en.length, 'paragraph']] }];
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const row = container.querySelector<HTMLElement>('[id="sn4.24:10.4"]')!;
    expect(row.style.borderLeft).toBe('');
    const line = row.querySelector<HTMLElement>('[data-seg]')!;
    expect(line.textContent).toBe(en);
    const verse = line.firstElementChild as HTMLElement;
    expect(verse.textContent).toBe('I weary myself with Gotama.” ');
    expect(verse.style.borderLeft).toContain('2px solid');
    const prose = line.querySelector('p')!;
    expect(prose.textContent).toBe('Then Māra left.');
    expect(prose.style.borderLeft).toBe('');
  });
});

describe('SegmentedText — paragraphs in three-level keys', () => {
  const segments: SegmentFile[] = [
    { key: 'dn1:1.21.0', pali: 'h', en: 'h', role: 'heading', headingLevel: 3 },
    { key: 'dn1:1.21.1', pali: 'a', en: 'a' },
    { key: 'dn1:1.21.2', pali: 'b', en: 'b' },
    { key: 'dn1:1.22.1', pali: 'c', en: 'c' },
    { key: 'mn10:4.0.2', pali: 'd', en: 'd', role: 'heading', headingLevel: 3 },
    { key: 'mn10:4.1', pali: 'e', en: 'e' },
  ];
  const gapBelow = (key: string) => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    return (container.querySelector(`#${key.replace(/[:.]/g, '\\$&')}`) as HTMLElement).style.marginBottom;
  };

  it('breaks between the paragraphs of a section', () => {
    expect(gapBelow('dn1:1.21.1')).toBe('0px');
    expect(gapBelow('dn1:1.21.2')).not.toBe('0px');
  });

  it("leaves a heading's gap to the heading, within its section", () => {
    expect(gapBelow('dn1:1.21.0')).toBe('0px');
    expect(gapBelow('mn10:4.0.2')).toBe('0px');
  });
});

// Regression coverage for a related bug: a direct link or search hit for one specific inner sutta
// of a batched document (e.g. "dhp321" within the loaded "dhp320-333" document) had no way to tell
// the reader which of the batch's many identical-looking verses it actually pointed at — see
// ReaderPage's requestedSubUid/subRange plumbing. Every segment in the wash range should sit in one
// tinted block; the segments around it should not.
describe('SegmentedText — washRange marks one inner sutta within a batched document', () => {
  const segments: SegmentFile[] = [
    { key: 'dhp321:1', pali: 'a', en: 'a', role: 'verse' },
    { key: 'dhp321:2', pali: 'b', en: 'b', role: 'verse' },
    { key: 'dhp322:1', pali: 'c', en: 'c', role: 'verse' },
  ];

  // The segments inside the tinted block.
  function tinted(container: HTMLElement): string[] {
    const block = container.querySelector('[data-wash-block]');
    return block ? [...block.children].map((row) => row.id) : [];
  }

  it('tints the segments in the range, and only those', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { washRange: [0, 1] })} />);
    expect(tinted(container)).toEqual(['dhp321:1', 'dhp321:2']);
  });

  it('marks nothing when washRange is unset', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    expect(tinted(container)).toEqual([]);
  });
});

// Highlights are immutable, so two devices highlighting overlapping spans offline both survive and
// arrive together — the reader is where the contest is settled, deterministically by (mtime, id).
describe('SegmentedText — overlapping highlights', () => {
  const segments: SegmentFile[] = [{ key: 'dn1:1.1', pali: 'p', en: '0123456789abcde' }];
  const older: Highlight = { id: 'h1', k0: 'dn1:1.1', o0: 0, k1: 'dn1:1.1', o1: 10, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
  const newer: Highlight = { id: 'h2', k0: 'dn1:1.1', o0: 5, k1: 'dn1:1.1', o1: 15, c: '#a8d8f0', m: '2026-01-02T00:00:00.000Z|dev' };

  function highlightSpans(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>('[data-hl-id]')].map((el) => [el.dataset.hlId, el.textContent]);
  }

  it('gives the contested characters to the later highlight', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { highlights: [older, newer] })} />);
    expect(highlightSpans(container)).toEqual([
      ['h1', '01234'],
      ['h2', '56789abcde'],
    ]);
  });

  it('renders the same regardless of the order the two arrive in', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { highlights: [newer, older] })} />);
    expect(highlightSpans(container)).toEqual([
      ['h1', '01234'],
      ['h2', '56789abcde'],
    ]);
  });

  // A click reports the highlight it was painted from, not the visible fragment — openPop resolves
  // the whole of it by id, so clicking the surviving sliver of a partly-covered highlight still
  // acts on all of it.
  it('reports the loser\'s own id when its surviving fragment is clicked', () => {
    const onSpanClick = vi.fn();
    const { container } = render(<SegmentedText {...baseProps(segments, { highlights: [older, newer], onSpanClick })} />);
    const [fragment] = container.querySelectorAll('[data-hl-id]');
    fragment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSpanClick).toHaveBeenCalledWith('h1', expect.anything(), older.c);
  });

  // The bug endpoints exist to prevent: an interior segment used to store the length it had when
  // the highlight was made, so a rewording left its tail unpainted.
  it('paints a middle segment in full, however long it has since become', () => {
    const threeSegments: SegmentFile[] = [
      { key: 'dn1:1.1', pali: 'p', en: 'one two' },
      { key: 'dn1:1.2', pali: 'p', en: 'a much longer middle line than before' },
      { key: 'dn1:1.3', pali: 'p', en: 'three four' },
    ];
    const across: Highlight = { id: 'h9', k0: 'dn1:1.1', o0: 4, k1: 'dn1:1.3', o1: 5, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
    const { container } = render(<SegmentedText {...baseProps(threeSegments, { highlights: [across] })} />);
    expect(highlightSpans(container)).toEqual([
      ['h9', 'two'],
      ['h9', 'a much longer middle line than before'],
      ['h9', 'three'],
    ]);
  });

  // A device holding a copy of the sutta without the segment an end names paints nothing for that
  // highlight, rather than a guess at where it belongs. Nothing deletes it, so it paints again on
  // the copy that has the segment.
  it('paints nothing when an end names a segment the loaded text lacks', () => {
    const shorter: SegmentFile[] = [
      { key: 'dn1:1.1', pali: 'p', en: 'one two' },
      { key: 'dn1:1.2', pali: 'p', en: 'three four' },
    ];
    const overrun: Highlight = { id: 'h9', k0: 'dn1:1.1', o0: 4, k1: 'dn1:1.6', o1: 2, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
    const { container } = render(<SegmentedText {...baseProps(shorter, { highlights: [overrun] })} />);
    expect(highlightSpans(container)).toEqual([]);
  });

  // An offset past the end of a segment reworded shorter still clamps: the segment is there, only
  // the text inside it moved.
  it('clamps an offset to the length the segment now has', () => {
    const segment: SegmentFile[] = [{ key: 'dn1:1.1', pali: 'p', en: 'one two' }];
    const overrun: Highlight = { id: 'h9', k0: 'dn1:1.1', o0: 4, k1: 'dn1:1.1', o1: 99, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
    const { container } = render(<SegmentedText {...baseProps(segment, { highlights: [overrun] })} />);
    expect(highlightSpans(container)).toEqual([['h9', 'two']]);
  });
});

// A translated closing line ("The Middle Discourses are complete.", MN152's last segment) is
// centred; its Pali reveal has to follow, or the same line reads half centred and half flush left.
describe('SegmentedText — the reveal under a closing line', () => {
  const segments: SegmentFile[] = [
    { key: 'mn152:20.7', pali: 'majjhimanikāyo samatto.', en: 'The Middle Discourses are complete.', role: 'end' },
  ];

  it('is centred, as the English above it is', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const reveal = container.querySelector('[data-reveal="pali"]') as HTMLElement;
    expect(reveal.style.textAlign).toBe('center');
  });

  it('leaves an ordinary segment flush left', () => {
    const plain: SegmentFile[] = [{ key: 'mn152:18.3', pali: 'Idamavoca bhagavā.', en: 'That is what the Buddha said.' }];
    const { container } = render(<SegmentedText {...baseProps(plain)} />);
    const reveal = container.querySelector('[data-reveal="pali"]') as HTMLElement;
    expect(reveal.style.textAlign).toBe('');
  });
});

// The Pali-first layout (ReaderPrefs' paliAbove). It is a property of "show all Pali" only: a tap
// reveal belongs under the line it explains, and inserting one above the tapped line would push
// that line down under the reader's eye.
describe('SegmentedText — Pali above the English', () => {
  const segments: SegmentFile[] = [
    { key: 'mn1:1.1', pali: 'Evaṁ me sutaṁ—', en: 'So I have heard.' },
  ];

  // Which of the two lines comes first in the DOM is the whole feature, so it is asserted on
  // document order rather than on any style the ordering happens to carry.
  function order(container: HTMLElement) {
    return [...container.querySelectorAll('[data-seg], [data-reveal="pali"]')].map((el) =>
      el.hasAttribute('data-reveal') ? 'pali' : 'en'
    );
  }

  it('puts the Pali first when every segment shows it', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, allPali: true, paliAbove: true })} />);
    expect(order(container)).toEqual(['pali', 'en']);
  });

  it('keeps the English first without the setting', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, allPali: true })} />);
    expect(order(container)).toEqual(['en', 'pali']);
  });

  it('leaves a tap reveal below the line it opens, whatever the setting says', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: { 0: true }, allPali: false, paliAbove: true })} />);
    expect(order(container)).toEqual(['en', 'pali']);
  });

  it('steps the English down a size, so the Pali leads the hierarchy', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, allPali: true, paliAbove: true })} />);
    const en = container.querySelector('[data-seg]') as HTMLElement;
    const pali = container.querySelector('[data-reveal="pali"]') as HTMLElement;
    expect(pali.style.fontSize).toBe('18px');
    expect(en.style.fontSize).toBe('16px');
  });

  // Not the mirror image: a Pali line under the English is the one the reader taps words in, so it
  // keeps the reading size and is set apart by its colour alone.
  it('leaves both lines at the reading size when the English leads', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, allPali: true })} />);
    const en = container.querySelector('[data-seg]') as HTMLElement;
    const pali = container.querySelector('[data-reveal="pali"]') as HTMLElement;
    expect(en.style.fontSize).toBe('18px');
    expect(pali.style.fontSize).toBe('18px');
  });
});

// A heading and a list item each carry spacing that belongs to the segment as a whole, not to the
// English line — the gap that binds a heading to the section it opens, and a list item's "N.".
// Both have to move to whichever line leads, or the heading drifts toward the paragraph above it
// and the number ends up beside the item's second line.
describe('SegmentedText — Pali above, for headings and list items', () => {
  it('gives the heading gap to the Pali and takes it off the English', () => {
    const segments: SegmentFile[] = [
      { key: 'dn1:1.1', pali: 'Paṭhamabhāṇavāro.', en: 'The first recitation section.', role: 'heading', headingLevel: 3 },
    ];
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, allPali: true, paliAbove: true })} />);
    const pali = container.querySelector('[data-reveal="pali"]') as HTMLElement;
    const heading = container.querySelector('[data-seg]') as HTMLElement;
    expect(parseInt(pali.style.marginTop, 10)).toBeGreaterThan(0);
    expect(heading.style.marginTop).toBe('0px');
  });

  it('renders the list marker in the Pali line, indented to match', () => {
    const segments: SegmentFile[] = [
      { key: 'an10.1:2.1', pali: 'Katame dasa?', en: 'What ten?', role: 'list-item' },
    ];
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, allPali: true, paliAbove: true })} />);
    const pali = container.querySelector('[data-reveal="pali"]') as HTMLElement;
    expect(pali.style.paddingLeft).toBe('24px');
    expect(pali.querySelector('[data-seg-ignore]')?.textContent).toBe('1.');
    expect(container.querySelector('[data-seg] [data-seg-ignore]')).toBeNull();
  });
});

describe('SegmentedText — the words an arriving search hit marks', () => {
  const segments: SegmentFile[] = [{ key: 'dn1:1.1', pali: 'Tena kho pana samayena', en: 'At that time the wanderer spoke' }];

  function markTexts(container: HTMLElement) {
    return [...container.querySelectorAll('mark')].map((el) => el.textContent);
  }

  it('marks exactly the stretches it is given, in the English and the Pali', () => {
    const marks = new Map<number, SegmentMarks>([[0, { en: [[8, 12]], pa: [[9, 13]] }]]);
    const { container } = render(<SegmentedText {...baseProps(segments, { marks })} />);
    expect(markTexts(container)).toEqual(['time', 'pana']);
  });

  it('keeps a Pali word marked in part one word for the dictionary', () => {
    const onWordClick = vi.fn();
    const marks = new Map<number, SegmentMarks>([[0, { en: [], pa: [[9, 11]] }]]);
    const { container } = render(<SegmentedText {...baseProps(segments, { marks, onWordClick })} />);
    expect(markTexts(container)).toEqual(['pa']);
    container.querySelector('mark')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onWordClick).toHaveBeenCalledWith('pana', 0, 2);
  });

  it('marks inside a highlight in a shade of its colour, and a click still opens the highlight', () => {
    const onSpanClick = vi.fn();
    const highlight: Highlight = { id: 'h1', k0: 'dn1:1.1', o0: 13, k1: 'dn1:1.1', o1: 31, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
    const marks = new Map<number, SegmentMarks>([[0, { en: [[8, 12], [17, 25]], pa: [] }]]);
    const { container } = render(<SegmentedText {...baseProps(segments, { highlights: [highlight], marks, onSpanClick })} />);
    const [plain, inHighlight] = container.querySelectorAll('mark');
    expect([plain.textContent, inHighlight.textContent]).toEqual(['time', 'wanderer']);
    expect(plain.closest('[data-hl-id]')).toBeNull();
    expect(inHighlight.closest('[data-hl-id]')?.getAttribute('data-hl-id')).toBe('h1');
    expect(inHighlight.style.background).toContain('color-mix');
    inHighlight.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSpanClick).toHaveBeenCalledWith('h1', expect.anything(), highlight.c);
  });
});

describe('SegmentedText — segment numbers', () => {
  const segments: SegmentFile[] = [
    { key: 'mn10:1.1', pali: 'Evaṁ me sutaṁ', en: 'So I have heard.' },
    { key: 'mn10:1.2', pali: 'Ekaṁ samayaṁ', en: 'At one time,', role: 'verse' },
  ];
  // A segment's number, as it shows beside its English line.
  const segmentNumber = (container: HTMLElement, i: number) =>
    container.querySelector(`[data-seg="${i}"] [data-seg-ignore]`) as HTMLElement | null;

  it('shows none while they are off', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {} })} />);
    expect(segmentNumber(container, 0)).toBeNull();
  });

  // Outside `seg.en`, so a highlight's offsets and copied text leave it out.
  it('shows each segment’s number, the part of its key after the colon, apart from its text', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, segmentNumbers: 'inline' })} />);
    expect(segmentNumber(container, 0)!.textContent).toBe('1.1');
    expect(segmentNumber(container, 0)!.style.userSelect).toBe('none');
  });

  it('hands a tapped number to the reader, and leaves the Pali closed', () => {
    const onSegmentNumber = vi.fn();
    const onToggleSeg = vi.fn();
    const { container } = render(
      <SegmentedText {...baseProps(segments, { openSegs: {}, segmentNumbers: 'inline', onSegmentNumber, onToggleSeg })} />
    );
    fireEvent.click(segmentNumber(container, 1)!);
    expect(onSegmentNumber).toHaveBeenCalledWith(1);
    expect(onToggleSeg).not.toHaveBeenCalled();
  });

  it('hangs a verse’s number in the margin past its rule, and a prose line’s beside the text', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, segmentNumbers: 'margin' })} />);
    expect(segmentNumber(container, 0)!.style.right).toBe('calc(100% + 14px)');
    expect(segmentNumber(container, 1)!.style.right).toBe('calc(100% + 30px)');
  });

  it('goes with the Pali when the Pali leads', () => {
    const { container } = render(
      <SegmentedText {...baseProps(segments, { allPali: true, paliAbove: true, segmentNumbers: 'inline' })} />
    );
    expect(container.querySelector('[data-reveal="pali"][data-reveal-seg="0"] [data-seg-ignore]')?.textContent).toBe('1.1');
    expect(segmentNumber(container, 0)).toBeNull();
  });
});

describe('SegmentedText — a Pali line opening', () => {
  const segments: SegmentFile[] = [{ key: 'mn10:1.1', pali: 'Evaṁ me sutaṁ', en: 'So I have heard.' }];
  const paliLine = (container: HTMLElement) => container.querySelector('[data-reveal="pali"]')!;

  it('fades in as it opens', () => {
    const { container, rerender } = render(<SegmentedText {...baseProps(segments, { openSegs: {} })} />);
    rerender(<SegmentedText {...baseProps(segments, { openSegs: { 0: true } })} />);
    expect(paliLine(container).classList).toContain('animate-fadeUp');
  });

  // A row the arrival wash wraps is mounted afresh, with its Pali already open.
  it('just shows on a row that mounts with it open', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: { 0: true } })} />);
    expect(paliLine(container).classList).not.toContain('animate-fadeUp');
  });
});


describe('SegmentedText — alternate translation markup', () => {
  const en = 'The heading First line\nSecond line: MN 1.';
  const segments: SegmentFile[] = [{
    key: 'mn2:1.1', en, pali: 'His paired Pali', role: 'verse',
    headings: [[0, 11]], links: [[36, 40, '/read/mn1?by=bodhi&at=1.1']],
    note: 'A note with <i>emphasis</i>.',
  }];

  it('keeps the stored text intact while rendering headings, verse breaks, links and notes', () => {
    const props = baseProps(segments, { showNotes: true, openNotes: { 0: true } });
    const { container } = render(<SegmentedText {...props} />);
    const line = container.querySelector<HTMLElement>('[data-seg]')!;
    expect(line.textContent).toBe(en + '1');
    expect(line.style.whiteSpace).toBe('pre-line');
    expect(line.querySelector('[style*="font-weight: 700"]')?.textContent).toBe('The heading');
    expect(container.querySelector('[data-reveal="pali"]')?.textContent).toBe('His paired Pali');
    expect(container.querySelector('[data-reveal="note"] i')?.textContent).toBe('emphasis');
    const link = line.querySelector('a')!;
    expect(link.textContent).toBe('MN 1');
    fireEvent.click(link);
    expect(props.onNoteLink).toHaveBeenCalledWith('/read/mn1?by=bodhi&at=1.1');
    expect(props.onToggleSeg).not.toHaveBeenCalled();
  });

  it('leaves modified reference clicks to the browser without toggling Pali', () => {
    const props = baseProps(segments);
    const { container } = render(<SegmentedText {...props} />);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    container.querySelector('[data-seg] a')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(props.onNoteLink).not.toHaveBeenCalled();
    expect(props.onToggleSeg).not.toHaveBeenCalled();
  });
});

describe('SegmentedText — translator speaker labels', () => {
  it.each([false, true])('keeps label styling, text offsets and a crossing highlight with Pali above %s', paliAbove => {
    const en = 'The Buddha:\nFirst line. Māra: See SN4.24.';
    const segments: SegmentFile[] = [{
      key: 'sn4.24:3.1', pali: 'Pali', en, role: 'verse', speakers: [[0, 11], [24, 29]],
      blocks: [[0, en.length, 'paragraph']], links: [[34, 40, '/read/sn4.24?by=thanissaro']],
    }];
    const highlight: Highlight = {
      id: 'speaker', k0: 'sn4.24:3.1', o0: 4, k1: 'sn4.24:3.1', o1: 38,
      c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev',
    };
    const props = baseProps(segments, { paliAbove, allPali: paliAbove, highlights: [highlight] });
    const { container } = render(<SegmentedText {...props} />);
    const line = container.querySelector<HTMLElement>('[data-seg]')!;
    expect(line.textContent).toBe(en);
    const labels = [...line.querySelectorAll<HTMLElement>('span[style*="font-size"]')];
    expect(labels.map(s => s.textContent)).toEqual(['The Buddha:', 'Māra:']);
    for (const label of labels) {
      expect(label.style.fontSize).toBe(`${(paliAbove ? 16 : 18) - 3}px`);
      expect(label.style.color).toBe('rgb(136, 136, 136)');
    }
    const painted = [...line.querySelectorAll('[data-hl-id]')];
    expect(painted.map(s => s.textContent).join('')).toBe(en.slice(4, 38));
    fireEvent.click(painted[0]);
    expect(props.onSpanClick).toHaveBeenCalledWith('speaker', expect.anything(), highlight.c);
    fireEvent.click(line.querySelector('a')!);
    expect(props.onNoteLink).toHaveBeenCalledWith('/read/sn4.24?by=thanissaro');
    expect(props.onToggleSeg).not.toHaveBeenCalled();
  });

  it.each([false, true])('sets a line’s opening label above it, outside the verse rule, with Pali above %s', paliAbove => {
    const segments: SegmentFile[] = [{ key: 'sn1.9:3.1', pali: 'Pali', en: 'First line,\nsecond line.', role: 'verse', speaker: 'The Buddha:' }];
    const props = baseProps(segments, { paliAbove, allPali: paliAbove });
    const { container } = render(<SegmentedText {...props} />);
    const row = container.querySelector<HTMLElement>('[id="sn1.9:3.1"]')!;
    const label = row.firstElementChild as HTMLElement;
    expect(label.textContent).toBe('The Buddha:');
    expect(row.style.borderLeft).toBe('');
    const ruled = label.nextElementSibling as HTMLElement;
    expect(ruled.style.borderLeft).toContain('2px solid');
    expect(ruled.querySelector('[data-seg]')!.textContent).toBe('First line,\nsecond line.');
    fireEvent.click(label);
    expect(props.onToggleSeg).toHaveBeenCalledWith(0);
  });
});

describe('SegmentedText — translator blocks inside one Pali line', () => {
  const en = 'An opening. First item; second, MN 1. A closing.';
  const segments: SegmentFile[] = [{
    key: 'dn1:1.21.2', en, pali: 'Paired Pali',
    blocks: [[0, 11, 'paragraph'], [12, 23, 'list-item'], [24, 37, 'list-item'], [38, 48, 'paragraph']],
    links: [[32, 36, '/read/mn1?by=bodhi']], note: 'A note.',
  }];
  const highlight: Highlight = {
    id: 'blocks', k0: 'dn1:1.21.2', o0: 3, k1: 'dn1:1.21.2', o1: 42, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev',
  };

  it('keeps one bullet per item and one paragraph per source block across a partial highlight', () => {
    const props = baseProps(segments, {
      highlights: [highlight], marks: new Map([[0, { en: [[20, 35]], pa: [] }]]),
    });
    const { container } = render(<SegmentedText {...props} />);
    const line = container.querySelector<HTMLElement>('[data-seg]')!;
    expect(line.tagName).toBe('DIV');
    expect(line.textContent).toBe(en);
    expect([...line.querySelectorAll('p')].map(p => p.textContent)).toEqual(['An opening.', 'A closing.']);
    expect([...line.querySelectorAll('ul > li')].map(li => li.textContent)).toEqual(['First item;', 'second, MN 1.']);
    expect(line.querySelector('ul')?.style.listStyleType).toBe('disc');
    expect([...line.querySelectorAll('[data-hl-id]')].map(el => el.textContent).join('')).toBe(en.slice(3, 42));
    expect([...line.querySelectorAll('mark')].map(el => el.textContent).join('')).toBe(en.slice(20, 35));
    fireEvent.click(line.querySelector('a')!);
    expect(props.onNoteLink).toHaveBeenCalledWith('/read/mn1?by=bodhi');
    fireEvent.click(line.querySelector('li [data-hl-id]')!);
    expect(props.onSpanClick).toHaveBeenCalledWith('blocks', expect.anything(), highlight.c);
    expect(props.onToggleSeg).not.toHaveBeenCalled();
  });

  it('keeps indented items tight and unbulleted through highlights, marks and links', () => {
    const indented: SegmentFile[] = [{ ...segments[0], blocks: segments[0].blocks!.map(([a, b, kind]) =>
      [a, b, kind === 'list-item' ? 'indented-item' : kind]) }];
    const props = baseProps(indented, { highlights: [highlight], marks: new Map([[0, { en: [[20, 35]], pa: [] }]]) });
    const { container } = render(<SegmentedText {...props} />);
    const line = container.querySelector<HTMLElement>('[data-seg]')!;
    const list = line.querySelector('ul')!;
    expect(line.textContent).toBe(en);
    expect(list.style.listStyleType).toBe('none');
    expect(list.style.paddingInlineStart).toBe('1.4em');
    expect(list.style.marginBottom).toBe('0px');
    expect([...list.querySelectorAll('li')].map(el => el.style.marginBlock)).toEqual(['0px', '0px']);
    expect([...line.querySelectorAll('[data-hl-id]')].map(el => el.textContent).join('')).toBe(en.slice(3, 42));
    expect([...line.querySelectorAll('mark')].map(el => el.textContent).join('')).toBe(en.slice(20, 35));
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEndBefore(line.querySelectorAll('li')[1]);
    expect(range.toString()).toBe(en.slice(0, 24));
    fireEvent.click(line.querySelector('a')!);
    expect(props.onNoteLink).toHaveBeenCalledWith('/read/mn1?by=bodhi');
    fireEvent.click(line.querySelector('li [data-hl-id]')!);
    expect(props.onSpanClick).toHaveBeenCalledWith('blocks', expect.anything(), highlight.c);
    expect(props.onToggleSeg).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps a list tight across Pali paragraph boundaries (Pali above: %s)', paliAbove => {
    const rows: SegmentFile[] = [
      { key: 'dn1:1.1', en: 'First item;', pali: 'First Pali', blocks: [[0, 11, 'indented-item']] },
      { key: 'dn1:2.1', en: 'second item.', pali: 'Second Pali', blocks: [[0, 12, 'indented-item']] },
      { key: 'dn1:3.1', en: 'Closing.', pali: 'Closing Pali' },
    ];
    const { container } = render(<SegmentedText {...baseProps(rows, { paliAbove, allPali: true })} />);
    const first = container.querySelector<HTMLElement>('[id="dn1:1.1"]')!;
    const last = container.querySelector<HTMLElement>('[id="dn1:2.1"]')!;
    expect(first.style.marginBottom).toBe('0px');
    expect(last.style.marginBottom).toBe('22px');
    expect([...container.querySelectorAll('ul')].map(el => el.style.margin)).toEqual(['0px', '0px']);
    expect([...container.querySelectorAll('[data-seg]')].map(el => el.textContent)).toEqual(rows.map(s => s.en));
    expect(container.querySelectorAll('[data-reveal="pali"]')).toHaveLength(3);
  });

  it('counts exactly the stored text through DOM ranges across block boundaries', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const line = container.querySelector<HTMLElement>('[data-seg]')!;
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEndBefore(line.querySelectorAll('li')[1]);
    expect(range.toString()).toBe(en.slice(0, 24));
    range.selectNodeContents(line);
    expect(range.toString()).toBe(en);
    fireEvent.click(line.querySelector('li')!);
    expect(container.querySelector('[data-reveal="pali"]')?.textContent).toBe('Paired Pali');
  });

  it('keeps inline segment and note numbers on the first and last text blocks', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { showNotes: true, segmentNumbers: 'inline' })} />);
    const line = container.querySelector<HTMLElement>('[data-seg]')!;
    expect(line.querySelector('p:first-child [data-seg-ignore]')?.textContent).toBe('1.21.2');
    expect(line.querySelector('p:last-child sup')?.textContent).toBe('1');
  });

  it('keeps a heading whole when a highlight crosses its middle', () => {
    const { container } = render(<SegmentedText {...baseProps([{
      ...segments[0], blocks: undefined, headings: [[0, 11]],
    }], { highlights: [highlight] })} />);
    const line = container.querySelector('[data-seg]')!;
    const headings = line.querySelectorAll('[style*="font-weight: 700"]');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('An opening.');
    expect(line.textContent).toBe(en);
  });
});
