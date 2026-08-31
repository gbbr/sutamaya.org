import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SegmentedText } from './SegmentedText';
import type { SegmentFile } from '../lib/corpus';
import type { Highlight, ThemeColors } from '../lib/types';

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
    onToggleSeg: vi.fn(),
    onWordClick: vi.fn(),
    onTextUp: vi.fn(),
    onSpanClick: vi.fn(),
    showNotes: false,
    openNotes: {},
    onToggleNote: vi.fn(),
    activeWord: null,
    ...overrides,
  };
}

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

// Regression coverage for a related bug: a direct link or search hit for one specific inner sutta
// of a batched document (e.g. "dhp321" within the loaded "dhp320-333" document) had no way to tell
// the reader which of the batch's many identical-looking verses it actually pointed at — see
// ReaderPage's requestedSubUid/focusUid plumbing. Every segment belonging to that inner sutta
// should pick up a background wash; segments belonging to a different inner sutta in the same
// batch should not.
describe('SegmentedText — focusUid marks one inner sutta within a batched document', () => {
  const segments: SegmentFile[] = [
    { key: 'dhp321:1', pali: 'a', en: 'a', role: 'verse' },
    { key: 'dhp322:1', pali: 'b', en: 'b', role: 'verse' },
  ];

  it('gives the focused inner sutta\'s segment a background wash', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { focusUid: 'dhp321' })} />);
    const row = container.querySelector('#dhp321\\:1') as HTMLElement;
    expect(row.style.background).not.toBe('');
  });

  it('leaves a different inner sutta in the same batch unmarked', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { focusUid: 'dhp321' })} />);
    const row = container.querySelector('#dhp322\\:1') as HTMLElement;
    expect(row.style.background).toBe('');
  });

  it('marks nothing when focusUid is unset', () => {
    const { container } = render(<SegmentedText {...baseProps(segments)} />);
    const row = container.querySelector('#dhp321\\:1') as HTMLElement;
    expect(row.style.background).toBe('');
  });
});

// Highlights are immutable, so two devices highlighting overlapping spans offline both survive and
// arrive together — the reader is where the contest is settled, deterministically by (mtime, id).
describe('SegmentedText — overlapping highlights', () => {
  const segments: SegmentFile[] = [{ key: 'dn1:1.1', pali: 'p', en: '0123456789abcde' }];
  const older: Highlight = { id: 'h1', i0: 0, o0: 0, i1: 0, o1: 10, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
  const newer: Highlight = { id: 'h2', i0: 0, o0: 5, i1: 0, o1: 15, c: '#a8d8f0', m: '2026-01-02T00:00:00.000Z|dev' };

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
    const across: Highlight = { id: 'h9', i0: 0, o0: 4, i1: 2, o1: 5, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
    const { container } = render(<SegmentedText {...baseProps(threeSegments, { highlights: [across] })} />);
    expect(highlightSpans(container)).toEqual([
      ['h9', 'two'],
      ['h9', 'a much longer middle line than before'],
      ['h9', 'three'],
    ]);
  });

  // A device holding an older, shorter copy of the sutta than the one the highlight was made
  // against: the end anchor names a segment that isn't there.
  it('stops at the last segment when the end anchor is past the end of the document', () => {
    const shorter: SegmentFile[] = [
      { key: 'dn1:1.1', pali: 'p', en: 'one two' },
      { key: 'dn1:1.2', pali: 'p', en: 'three four' },
    ];
    const overrun: Highlight = { id: 'h9', i0: 0, o0: 4, i1: 6, o1: 2, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' };
    const { container } = render(<SegmentedText {...baseProps(shorter, { highlights: [overrun] })} />);
    expect(highlightSpans(container)).toEqual([
      ['h9', 'two'],
      ['h9', 'three four'],
    ]);
  });
});

// A segment SuttaCentral left with no English at all — an elided repetition, an untranslated
// uddāna verse — has no visible line to tap, so its Pali is never the reader's to open. Rendering
// it put Pali on screen that the reader had not asked for and could not have asked for.
describe('SegmentedText — segments with no English', () => {
  const segments: SegmentFile[] = [
    { key: 'sn35.33:1.1', pali: 'Sāvatthinidānaṁ.', en: 'At Sāvatthī.' },
    { key: 'sn35.33:1.2', pali: 'Tatra kho …pe…', en: '' },
  ];

  it('renders no Pali for one whose reveal has been opened', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: { 0: true, 1: true } })} />);
    const words = [...container.querySelectorAll('.pw')].map((el) => el.textContent);
    expect(words).toEqual(['Sāvatthinidānaṁ.']);
  });

  it('renders no Pali for one under "show all Pali" either', () => {
    const { container } = render(<SegmentedText {...baseProps(segments, { openSegs: {}, allPali: true })} />);
    const words = [...container.querySelectorAll('.pw')].map((el) => el.textContent);
    expect(words).toEqual(['Sāvatthinidānaṁ.']);
  });
});

// An untranslated closing colophon ("Dasamaṁ.") stands in the English column as its own Pali, and
// renders as tappable words in place. Opening a reveal under it would print the same line twice.
describe('SegmentedText — untranslated colophon', () => {
  const segments: SegmentFile[] = [{ key: 'sn35.42:1.3', pali: 'Dasamaṁ.', en: 'Dasamaṁ.', role: 'end' }];

  it('renders its Pali once, with no reveal beneath it, even when it carries a highlight', () => {
    const highlights: Highlight[] = [{ id: 'h1', i0: 0, o0: 0, i1: 0, o1: 4, c: '#ffe08a', m: '2026-01-01T00:00:00.000Z|dev' }];
    const { container } = render(<SegmentedText {...baseProps(segments, { highlights })} />);
    expect(container.querySelector('[data-reveal="pali"]')).toBeNull();
    expect([...container.querySelectorAll('.pw')].map((el) => el.textContent)).toEqual(['Dasamaṁ.']);
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
