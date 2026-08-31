import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MatchedText } from './MatchedText';

describe('MatchedText', () => {
  it('leaves a field that is not a note alone, asterisks and all', () => {
    const { container } = render(<MatchedText text="two *stars* here" query="" />);
    expect(container.textContent).toBe('two *stars* here');
    expect(container.querySelector('strong')).toBeNull();
    cleanup();
  });

  // The two passes wrap ranges of the same string, so this is the one that would break if the
  // markers were stripped after the query words were found rather than before.
  it('still marks a searched word inside a bold run', () => {
    const { container } = render(<MatchedText text="the *middle way* here" query="middle" notation />);
    expect(container.textContent).toBe('the middle way here');
    expect(container.querySelector('strong')?.textContent).toBe('middle way');
    expect(container.querySelector('strong mark')?.textContent).toBe('middle');
    cleanup();
  });

  it('marks a searched word that the markers sit against', () => {
    const { container } = render(<MatchedText text="a *note* of it" query="note" notation />);
    expect(container.querySelector('mark')?.textContent).toBe('note');
    cleanup();
  });
});
