import { describe, it, expect } from 'vitest';
import { boldRuns } from './noteFormat';

const bolded = (s: string) => boldRuns(s).filter((r) => r.bold).map((r) => r.text);
const shown = (s: string) => boldRuns(s).map((r) => r.text).join('');

describe('boldRuns', () => {
  it('marks a pair and drops its markers', () => {
    expect(boldRuns('see *this* one')).toEqual([
      { text: 'see ', bold: false },
      { text: 'this', bold: true },
      { text: ' one', bold: false },
    ]);
  });

  it('leaves a note with no markers as one run', () => {
    expect(boldRuns('nothing marked')).toEqual([{ text: 'nothing marked', bold: false }]);
  });

  it('leaves bullet lines alone', () => {
    const note = '* first\n* second';
    expect(bolded(note)).toEqual([]);
    expect(shown(note)).toBe(note);
  });

  it('still finds a real pair on a line that opens with a bullet', () => {
    expect(bolded('* buy *milk* today')).toEqual(['milk']);
  });

  it('ignores a lone asterisk and one that spans lines', () => {
    expect(bolded('2 * 3 is six')).toEqual([]);
    expect(bolded('opened *here\nclosed* there')).toEqual([]);
  });

  it('leaves the outer markers of a doubled pair on the page', () => {
    expect(bolded('**loud**')).toEqual(['loud']);
    expect(shown('**loud**')).toBe('*loud*');
  });

  // A note is free text: any arrangement of asterisks, spaces and newlines can arrive, including
  // ones written years before this notation existed. Whatever comes in has to come out — same
  // characters in the same order, minus only the markers of a pair that actually closed.
  it('never loses, reorders or invents a character', () => {
    const alphabet = ['*', ' ', '\n', 'a', 'b'];
    for (let n = 0; n < 3000; n++) {
      let note = '';
      for (let i = Math.floor(Math.random() * 12); i > 0; i--) {
        note += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const out = shown(note);
      // Everything that isn't a marker survives untouched, and markers only ever leave in pairs.
      expect(out.replace(/\*/g, '')).toBe(note.replace(/\*/g, ''));
      expect((note.length - out.length) % 2).toBe(0);
      expect(out.length).toBeLessThanOrEqual(note.length);
    }
  });
});
