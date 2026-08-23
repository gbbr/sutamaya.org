import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SlidingPillToggle } from './SlidingPillToggle';

function renderToggle(overrides: Partial<Parameters<typeof SlidingPillToggle>[0]> = {}) {
  const onClick = vi.fn();
  const utils = render(
    <SlidingPillToggle
      active="left"
      onClick={onClick}
      ariaLabel="Toggle"
      leftIcon={<span>L</span>}
      rightIcon={<span>R</span>}
      leftIconClassName="text-ink"
      rightIconClassName="text-ink-4"
      slotSize={24}
      thumbClassName="bg-chip"
      {...overrides}
    />
  );
  return { onClick, ...utils };
}

describe('SlidingPillToggle', () => {
  it('positions the thumb at the left edge when active is "left"', () => {
    renderToggle({ active: 'left' });
    const thumb = document.querySelector('.absolute.top-\\[2px\\]') as HTMLElement;
    expect(thumb.style.left).toBe('2px');
    expect(thumb.style.width).toBe('calc(50% - 2px)');
  });

  it('positions the thumb at the midpoint when active is "right"', () => {
    renderToggle({ active: 'right' });
    const thumb = document.querySelector('.absolute.top-\\[2px\\]') as HTMLElement;
    expect(thumb.style.left).toBe('50%');
  });

  it('applies the caller-supplied thumb classes', () => {
    renderToggle({ thumbClassName: 'bg-accent2 shadow-lg' });
    const thumb = document.querySelector('.absolute.top-\\[2px\\]') as HTMLElement;
    expect(thumb.className).toContain('bg-accent2');
    expect(thumb.className).toContain('shadow-lg');
  });

  it('applies the caller-supplied color classes to each icon slot, plus its own shared layout/transition classes', () => {
    renderToggle({ leftIconClassName: 'text-ink', rightIconClassName: 'text-ink-4' });
    const left = screen.getByText('L').parentElement as HTMLElement;
    const right = screen.getByText('R').parentElement as HTMLElement;
    expect(left.className).toContain('text-ink');
    expect(left.className).toContain('transition-colors');
    expect(right.className).toContain('text-ink-4');
  });

  it('sizes both icon slots from slotSize', () => {
    renderToggle({ slotSize: 30 });
    const left = screen.getByText('L').parentElement as HTMLElement;
    const right = screen.getByText('R').parentElement as HTMLElement;
    expect(left.style.width).toBe('30px');
    expect(left.style.height).toBe('30px');
    expect(right.style.width).toBe('30px');
  });

  it('renders aria-label/title and calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const { onClick } = renderToggle({ ariaLabel: 'Switch to Group', title: 'Switch to Group' });
    const btn = screen.getByRole('button', { name: 'Switch to Group' });
    expect(btn.title).toBe('Switch to Group');
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onMouseDown when given, e.g. to preventDefault and keep focus on a sibling input', async () => {
    const user = userEvent.setup();
    const onMouseDown = vi.fn();
    renderToggle({ onMouseDown });
    await user.click(screen.getByRole('button'));
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it('is a type="button" so it never submits an enclosing form', () => {
    renderToggle();
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});
