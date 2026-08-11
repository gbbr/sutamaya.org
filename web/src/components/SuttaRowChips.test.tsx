import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuttaRowChips } from './SuttaRowChips';
import { READER_THEMES } from '../lib/theme';
import type { SuttaRowChip } from '../lib/lists';

const chips: SuttaRowChip[] = [
  { id: 'l1', breadcrumb: 'Favorites' },
  { id: 'l2', breadcrumb: 'Study / Chapter 1' },
];

describe('SuttaRowChips', () => {
  it('renders nothing when there are no chips and no highlights', () => {
    const { container } = render(<SuttaRowChips chips={[]} hlCount={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip per list and the highlight badge when either is present', () => {
    render(<SuttaRowChips chips={chips} hlCount={3} />);
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getByText('Study / Chapter 1')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders just the badge when there are highlights but no list membership', () => {
    render(<SuttaRowChips chips={[]} hlCount={2} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders just the chips when there is list membership but no highlights', () => {
    render(<SuttaRowChips chips={chips} hlCount={0} />);
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  describe('without a theme (ListPane/TreePane/read-only rows)', () => {
    it('renders chips as plain non-interactive spans, not buttons', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} />);
      expect(screen.getByText('Favorites').tagName).toBe('SPAN');
      expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull();
    });

    it('renders the highlight badge as a plain span when no onHighlightClick is given', () => {
      render(<SuttaRowChips chips={[]} hlCount={4} />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('falls back to the app-shell ink border class on each chip', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} />);
      expect(screen.getByText('Favorites').className).toContain('border-ink/25');
    });
  });

  describe('with a theme (the Reader)', () => {
    const theme = READER_THEMES.dark;

    it('styles each chip from the theme instead of the ink Tailwind classes', () => {
      render(<SuttaRowChips chips={chips} hlCount={0} theme={theme} />);
      const chip = screen.getByText('Favorites');
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

    it('passes the theme through to the highlight badge', () => {
      render(<SuttaRowChips chips={[]} hlCount={5} theme={theme} />);
      // HighlightCountBadge renders its own count text inside a themed span/button — background
      // comes from theme.tint (see HighlightCountBadge's own theme branch).
      const badge = screen.getByText('5').closest('span,button') as HTMLElement;
      const probe = document.createElement('div');
      probe.style.background = theme.tint;
      probe.style.color = theme.fg;
      expect(badge.style.background).toBe(probe.style.background);
      expect(badge.style.color).toBe(probe.style.color);
    });
  });

  describe('interactive chips (the Reader sutta header)', () => {
    it('renders each chip as a button and calls onChipClick with that chip\'s id, stopping propagation', async () => {
      const user = userEvent.setup();
      const onChipClick = vi.fn();
      const outerClick = vi.fn();
      render(
        <div onClick={outerClick}>
          <SuttaRowChips chips={chips} hlCount={0} onChipClick={onChipClick} />
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
      render(<SuttaRowChips chips={[]} hlCount={6} onHighlightClick={onHighlightClick} />);
      await user.click(screen.getByRole('button', { name: /6/ }));
      expect(onHighlightClick).toHaveBeenCalledTimes(1);
    });

    it('does not turn the highlight badge into a button when only onChipClick is given', () => {
      const onChipClick = vi.fn();
      render(<SuttaRowChips chips={[]} hlCount={7} onChipClick={onChipClick} />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
