import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useFontsLoaded } from './useFontsLoaded';

const loadedFonts = document.fonts;

// Puts a font mid-load, returning the call that finishes it.
function fontLoading() {
  let finish = () => {};
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready } });
  return finish;
}

function Probe({ content }: { content: object | null }) {
  return <div data-testid="probe">{String(useFontsLoaded(content))}</div>;
}

afterEach(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: loadedFonts });
  vi.useRealTimers();
});

describe('useFontsLoaded', () => {
  it('is false with nothing rendered', () => {
    render(<Probe content={null} />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
  });

  it('is true in the same commit when no font is loading', () => {
    render(<Probe content={{}} />);
    expect(screen.getByTestId('probe').textContent).toBe('true');
  });

  it('waits for a loading font, and again for new content', async () => {
    const finish = fontLoading();
    const { rerender } = render(<Probe content={{}} />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
    await act(async () => finish());
    expect(screen.getByTestId('probe').textContent).toBe('true');

    fontLoading();
    rerender(<Probe content={{}} />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
  });

  it('is true at once, with a warning, where the font API is missing', () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Probe content={{}} />);
    expect(screen.getByTestId('probe').textContent).toBe('true');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('gives up on a font that never loads after a second', () => {
    vi.useFakeTimers();
    fontLoading();
    render(<Probe content={{}} />);
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByTestId('probe').textContent).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('probe').textContent).toBe('true');
  });
});
