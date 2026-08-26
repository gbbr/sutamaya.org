import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuttaRowChips } from './SuttaRowChips';
import { HIGHLIGHT_COLORS, highlightPaint, READER_THEMES } from '../lib/theme';
import type { SuttaRowChip } from '../lib/lists';

const chips: SuttaRowChip[] = [
  { id: 'l1', label: 'Favorites', breadcrumb: 'Favorites' },
  { id: 'l2', label: 'Chapter 1', parent: 'Study', breadcrumb: 'Study / Chapter 1' },
];

// Two of the three palette colours, so a swatch assertion can tell "one per colour used" apart
// from "one per palette colour".
const hlColors = [HIGHLIGHT_COLORS[0], HIGHLIGHT_COLORS[2]];

// A chip renders as a pill wrapping one or two segments, so the element carrying the chip's own
// classes/title/style is the parent of the element the label text is found in.
const pillOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe('SuttaRowChips', () => {
  it('renders nothing when there are no chips and no highlights', () => {
    const { container } = render(<SuttaRowChips chips={[]} hlCount={0} hlColors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip per list and the highlight badge when either is present', () => {
    render(<SuttaRowChips chips={chips} hlCount={3} hlColors={hlColors} />);
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getByText('Chapter 1')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('gives a nested list a leading segment naming its immediate parent', () => {
    render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} />);
    expect(pillOf('Chapter 1').textContent).toBe('StudyChapter 1');
    // The full path stays out of the chip's own text — it's the hover title, nothing more.
    expect(screen.queryByText('Study / Chapter 1')).toBeNull();
    expect(pillOf('Chapter 1').getAttribute('title')).toBe('Study / Chapter 1');
  });

  it('renders a top-level list as a single-segment chip', () => {
    render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} />);
    expect(pillOf('Favorites').textContent).toBe('Favorites');
  });

  it('renders just the badge when there are highlights but no list membership', () => {
    render(<SuttaRowChips chips={[]} hlCount={2} hlColors={hlColors} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders just the chips when there is list membership but no highlights', () => {
    render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} />);
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  describe('without a theme (ListPane/TreePane/read-only rows)', () => {
    it('renders chips as plain non-interactive spans, not buttons', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} />);
      expect(screen.getByText('Favorites').tagName).toBe('SPAN');
      expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull();
    });

    it('renders the highlight badge as a plain span when no onHighlightClick is given', () => {
      render(<SuttaRowChips chips={[]} hlCount={4} hlColors={hlColors} />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('falls back to the app-shell ink border class on each chip', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} />);
      expect(pillOf('Favorites').className).toContain('border-ink/25');
    });

    it('falls back to the app-shell ink fill on a parent segment', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} />);
      expect(screen.getByText('Study').className).toContain('bg-ink/10');
    });
  });

  describe('with a theme (the Reader)', () => {
    const theme = READER_THEMES.dark;

    it('styles each chip from the theme instead of the ink Tailwind classes', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} theme={theme} />);
      const chip = pillOf('Favorites');
      expect(chip.className).not.toContain('border-ink/25');
      // jsdom re-serializes the rgba() it's given (spaced-out components, trailing zero) rather
      // than preserving the literal string, so compare against a probe element run through the
      // same normalization instead of the raw theme.rule/theme.fg strings.
      const probe = document.createElement('div');
      probe.style.border = `1px solid ${theme.rule}`;
      probe.style.color = theme.fg;
      expect(chip.style.border).toBe(probe.style.border);
      expect(chip.style.color).toBe(probe.style.color);
    });

    it('fills a parent segment from the theme\'s tint rather than the ink class', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} hlColors={[]} theme={theme} />);
      const seg = screen.getByText('Study');
      expect(seg.className).not.toContain('bg-ink/10');
      const probe = document.createElement('div');
      probe.style.background = theme.tint;
      expect(seg.style.background).toBe(probe.style.background);
      // No colour of its own: the segment inherits the pill's `theme.fg`, since a quieter rung
      // over this fill drops below a legible contrast (see SuttaRowChips).
      expect(seg.style.color).toBe('');
    });

    it('passes the theme through to the highlight badge', () => {
      render(<SuttaRowChips chips={[]} hlCount={5} hlColors={hlColors} theme={theme} />);
      // HighlightCountBadge carries no fill of its own — the swatches are the colour on the line —
      // so what the theme sets here is the muted ink of the number, which keeps it off the
      // accent-coloured Pali line above it. It arrives as a custom property, which is what leaves
      // room for the hover rule to restate it.
      const badge = screen.getByText('5').closest('span,button') as HTMLElement;
      expect(badge.style.getPropertyValue('--hl-ink')).toBe(theme.dim);
      expect(badge.style.getPropertyValue('--hl-ink-hover')).toBe(theme.fg);
    });

    it('paints one badge swatch per colour used, in the theme\'s own rendering of it', () => {
      render(<SuttaRowChips chips={[]} hlCount={5} hlColors={hlColors} theme={theme} />);
      const badge = screen.getByText('5').closest('span,button') as HTMLElement;
      const swatches = [...badge.querySelectorAll<HTMLElement>('[data-swatch]')];
      expect(swatches.length).toBe(2);
      // Dark substitutes its own deeper fill for a stored pastel (highlightPaint); light and sepia
      // paint the stored colour itself — the same rule the highlighted text follows, so a swatch
      // matches what the reader actually sees on the page.
      const probe = document.createElement('div');
      swatches.forEach((s, i) => {
        probe.style.background = highlightPaint(hlColors[i], theme);
        expect(s.style.background).toBe(probe.style.background);
      });
    });
  });

  describe('interactive chips (the Reader sutta header)', () => {
    it('renders each chip as a button and calls onChipClick with that chip\'s id, stopping propagation', async () => {
      const user = userEvent.setup();
      const onChipClick = vi.fn();
      const outerClick = vi.fn();
      render(
        <div onClick={outerClick}>
          <SuttaRowChips chips={chips} hlCount={0} hlColors={[]} onChipClick={onChipClick} />
        </div>
      );
      const chip = screen.getByRole('button', { name: 'Favorites' });
      await user.click(chip);
      expect(onChipClick).toHaveBeenCalledWith('l1');
      expect(outerClick).not.toHaveBeenCalled();
    });

    it('renders the highlight badge as a button and calls onHighlightClick when given', async () => {
      const user = userEvent.setup();
      const onHighlightClick = vi.fn();
      render(<SuttaRowChips chips={[]} hlCount={6} hlColors={hlColors} onHighlightClick={onHighlightClick} />);
      await user.click(screen.getByRole('button', { name: /6/ }));
      expect(onHighlightClick).toHaveBeenCalledTimes(1);
    });

    it('does not turn the highlight badge into a button when only onChipClick is given', () => {
      const onChipClick = vi.fn();
      render(<SuttaRowChips chips={[]} hlCount={7} hlColors={hlColors} onChipClick={onChipClick} />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
