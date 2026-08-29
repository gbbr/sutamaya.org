import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DESCRIPTION, setMetaDescription } from './documentMeta';

const content = () => document.querySelector('meta[name="description"]')?.getAttribute('content');

describe('setMetaDescription', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="description" content="initial" />';
  });

  it('writes the text it is given', () => {
    setMetaDescription('The Buddha presents an analysis of 62 kinds of wrong view.');
    expect(content()).toBe('The Buddha presents an analysis of 62 kinds of wrong view.');
  });

  // Blurbs come from the corpus with the translator's inline markup still in them, which would
  // otherwise reach the search result as literal angle brackets.
  it('strips inline HTML and collapses whitespace', () => {
    setMetaDescription('A <i>brahmin</i> visits\n  the Buddha.');
    expect(content()).toBe('A brahmin visits the Buddha.');
  });

  it('cuts a long blurb at a word boundary', () => {
    setMetaDescription(`${'word '.repeat(60)}end`);
    const out = content() ?? '';
    expect(out.length).toBeLessThanOrEqual(156); // 155 plus the ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/); // trimmed, not cut mid-space
  });

  it('leaves a description that already fits alone', () => {
    const text = 'A young brahmin student attacks the Buddha’s family, but is put in his place.';
    setMetaDescription(text);
    expect(content()).toBe(text);
  });

  // Every page that has nothing of its own to say — Settings, a search, a user list — and every
  // unmount, which is what puts the app-wide text back.
  it('restores the default for null, undefined and an empty string', () => {
    for (const value of [null, undefined, '']) {
      setMetaDescription('something specific');
      setMetaDescription(value);
      expect(content()).toBe(DEFAULT_DESCRIPTION);
    }
  });

  it('does nothing when the page has no description tag', () => {
    document.head.innerHTML = '';
    expect(() => setMetaDescription('anything')).not.toThrow();
  });
});
