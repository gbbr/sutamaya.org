import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutsModal } from './ShortcutsModal';
import { READER_THEMES } from '../lib/theme';
import type { Shortcut } from '../lib/shortcuts';

const shortcuts: Shortcut[] = [
  { match: ['/'], keys: ['/'], label: 'Search', scope: 'library' },
  { match: ['ArrowUp', 'ArrowDown'], keys: ['↑', '↓'], label: 'Move', scope: 'library' },
];

describe('ShortcutsModal', () => {
  it('renders one row per shortcut with its label and every key', () => {
    render(<ShortcutsModal shortcuts={shortcuts} onClose={vi.fn()} />);
    expect(screen.getByText('Search')).toBeTruthy();
    expect(screen.getByText('Move')).toBeTruthy();
    expect(screen.getByText('/')).toBeTruthy();
    expect(screen.getByText('↑')).toBeTruthy();
    expect(screen.getByText('↓')).toBeTruthy();
  });

  it('calls onClose when clicking the backdrop or the Esc button, but not when clicking inside the sheet', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal shortcuts={shortcuts} onClose={onClose} />);
    fireEvent.click(screen.getByText('Search')); // inside the sheet
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('without a theme (LibraryPage)', () => {
    it('styles the sheet with the app-shell ink/paper Tailwind classes', () => {
      render(<ShortcutsModal shortcuts={shortcuts} onClose={vi.fn()} />);
      const sheet = document.querySelector('[data-component="ShortcutsModal"]') as HTMLElement;
      expect(sheet.className).toContain('bg-paper');
      expect(sheet.className).toContain('border-ink/10');
      expect(sheet.className).toContain('rounded-sheet');
    });
  });

  describe('with a theme (the Reader)', () => {
    const theme = READER_THEMES.dark;

    it('styles the sheet from the theme instead of the ink/paper Tailwind classes', () => {
      render(<ShortcutsModal shortcuts={shortcuts} onClose={vi.fn()} theme={theme} />);
      const sheet = document.querySelector('[data-component="ShortcutsModal"]') as HTMLElement;
      expect(sheet.className).not.toContain('bg-paper');
      expect(sheet.className).not.toContain('border-ink/10');
      expect(sheet.className).toContain('rounded-2xl');
      const probe = document.createElement('div');
      probe.style.background = theme.panel;
      expect(sheet.style.background).toBe(probe.style.background);
    });

    it('styles each key chip from the theme', () => {
      render(<ShortcutsModal shortcuts={shortcuts} onClose={vi.fn()} theme={theme} />);
      const key = screen.getByText('/');
      expect(key.className).not.toContain('bg-chip');
      const probe = document.createElement('div');
      probe.style.border = `1px solid ${theme.rule}`;
      expect(key.style.border).toBe(probe.style.border);
    });
  });
});
