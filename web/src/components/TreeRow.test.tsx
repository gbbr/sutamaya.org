import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TreeRow } from './TreeRow';
import type { ChapterRow } from '../lib/types';

const leaf: ChapterRow = { id: 'an1', ref: 'AN 1', label: 'Book of Ones', count: 50 };
const expandable: ChapterRow = {
  id: 'an1-parent',
  ref: 'AN',
  label: 'Numbered Discourses',
  count: 100,
  chapters: [leaf],
};

describe('TreeRow', () => {
  it('does not indent the first level beyond the 18px base', () => {
    render(<TreeRow node={leaf} depth={1} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />);
    const row = screen.getByText('Book of Ones').closest('button') as HTMLButtonElement;
    expect(row.style.paddingLeft).toBe('18px');
  });

  it('indents deeper rows by 14px per depth level past the first, offset from the 18px base', () => {
    render(<TreeRow node={leaf} depth={2} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />);
    const row = screen.getByText('Book of Ones').closest('button') as HTMLButtonElement;
    expect(row.style.paddingLeft).toBe('32px'); // 18 + (2-1)*14
  });

  it('shows a chevron only when the row has children to expand', () => {
    const { rerender } = render(<TreeRow node={leaf} depth={0} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />);
    expect(document.querySelector('.lucide-chevron-right')).not.toBeInTheDocument();
    expect(document.querySelector('.lucide-chevron-down')).not.toBeInTheDocument();

    rerender(<TreeRow node={expandable} depth={0} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />);
    expect(document.querySelector('.lucide-chevron-right')).toBeInTheDocument();

    rerender(<TreeRow node={expandable} depth={0} expanded={{ [expandable.id]: true }} onToggle={vi.fn()} onSelect={vi.fn()} />);
    expect(document.querySelector('.lucide-chevron-down')).toBeInTheDocument();
  });

  it('clicking a non-expandable row calls onSelect, not onToggle', async () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(<TreeRow node={leaf} depth={0} expanded={{}} onToggle={onToggle} onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Book of Ones'));
    expect(onSelect).toHaveBeenCalledWith('an1');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('clicking an expandable row calls onToggle, not onSelect, and reveals children when open', async () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(<TreeRow node={expandable} depth={0} expanded={{}} onToggle={onToggle} onSelect={onSelect} />);
    expect(screen.queryByText('Book of Ones')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Numbered Discourses'));
    expect(onToggle).toHaveBeenCalledWith('an1-parent');
    expect(onSelect).not.toHaveBeenCalled();

    rerender(<TreeRow node={expandable} depth={0} expanded={{ [expandable.id]: true }} onToggle={onToggle} onSelect={onSelect} />);
    expect(screen.getByText('Book of Ones')).toBeInTheDocument();
  });
});
