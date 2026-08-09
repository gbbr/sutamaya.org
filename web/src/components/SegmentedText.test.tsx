import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SegmentedText } from './SegmentedText';
import type { SegmentFile } from '../lib/corpus';
import type { ThemeColors } from '../lib/types';

const theme: ThemeColors = { bg: '#fff', fg: '#000', dim: '#888', rule: '#ccc', panel: '#fff', pali: '#333', tint: '#eee', highlightAlpha: 1 };

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
