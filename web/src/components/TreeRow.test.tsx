import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TreeRow } from './TreeRow';
import { LayoutProvider, MOBILE_BREAKPOINT } from '../context/LayoutContext';
import type { ChapterRow } from '../lib/types';
import type { ReactElement } from 'react';

const leaf: ChapterRow = { id: 'an1', ref: 'AN 1', label: 'Book of Ones', count: 50 };
const expandable: ChapterRow = {
  id: 'an1-parent',
  ref: 'AN',
  label: 'Numbered Discourses',
  count: 100,
  chapters: [leaf],
};

// TreeRow's own indent reads LayoutContext's `mobile` flag, so every render needs a provider;
// tests that don't care about width just get the desktop default from renderAt's own default.
function renderAt(width: number, ui: ReactElement) {
  window.innerWidth = width;
  return render(<LayoutProvider>{ui}</LayoutProvider>);
}
const renderDesktop = (ui: ReactElement) => renderAt(1440, ui);
const renderMobile = (ui: ReactElement) => renderAt(MOBILE_BREAKPOINT - 1, ui);

describe('TreeRow', () => {
  it('indents first level by 14px from the 24px base once both panes fit (mobile)', () => {
    renderMobile(<TreeRow node={leaf} depth={1} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />);
    const row = screen.getByText('Book of Ones').closest('button') as HTMLButtonElement;
    expect(row.style.paddingLeft).toBe('38px'); // 24 + 1*14
  });

  it('indents deeper rows by 14px per depth level past the first, offset from the 24px base (mobile)', () => {
    renderMobile(<TreeRow node={leaf} depth={2} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />);
    const row = screen.getByText('Book of Ones').closest('button') as HTMLButtonElement;
    expect(row.style.paddingLeft).toBe('52px'); // 24 + 2*14
  });

  it('indents every level by 14px from the 24px base once both panes fit (non-mobile)', () => {
    renderDesktop(<TreeRow node={leaf} depth={1} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />);
    const row = screen.getByText('Book of Ones').closest('button') as HTMLButtonElement;
    expect(row.style.paddingLeft).toBe('38px'); // 24 + 1*14
  });

  it('shows a chevron only when the row has children to expand', () => {
    const { rerender } = render(
      <LayoutProvider>
        <TreeRow node={leaf} depth={0} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />
      </LayoutProvider>
    );
    expect(document.querySelector('.lucide-chevron-right')).not.toBeInTheDocument();
    expect(document.querySelector('.lucide-chevron-down')).not.toBeInTheDocument();

    rerender(
      <LayoutProvider>
        <TreeRow node={expandable} depth={0} expanded={{}} onToggle={vi.fn()} onSelect={vi.fn()} />
      </LayoutProvider>
    );
    expect(document.querySelector('.lucide-chevron-right')).toBeInTheDocument();

    rerender(
      <LayoutProvider>
        <TreeRow node={expandable} depth={0} expanded={{ [expandable.id]: true }} onToggle={vi.fn()} onSelect={vi.fn()} />
      </LayoutProvider>
    );
    expect(document.querySelector('.lucide-chevron-down')).toBeInTheDocument();
  });

  it('clicking a non-expandable row calls onSelect, not onToggle', async () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    renderDesktop(<TreeRow node={leaf} depth={0} expanded={{}} onToggle={onToggle} onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Book of Ones'));
    expect(onSelect).toHaveBeenCalledWith('an1');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('clicking an expandable row calls onToggle, not onSelect, and reveals children when open', async () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(
      <LayoutProvider>
        <TreeRow node={expandable} depth={0} expanded={{}} onToggle={onToggle} onSelect={onSelect} />
      </LayoutProvider>
    );
    expect(screen.queryByText('Book of Ones')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Numbered Discourses'));
    expect(onToggle).toHaveBeenCalledWith('an1-parent');
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <LayoutProvider>
        <TreeRow node={expandable} depth={0} expanded={{ [expandable.id]: true }} onToggle={onToggle} onSelect={onSelect} />
      </LayoutProvider>
    );
    expect(screen.getByText('Book of Ones')).toBeInTheDocument();
  });
});
