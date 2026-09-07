import { describe, expect, it } from 'vitest';
import { parseD1Json } from './lib/wranglerJson.js';

// The rows come back through a CLI's stdout rather than an API, so the parse has to survive
// whatever wrangler prints around them. A `--file` run prints a coloured upload banner, and an ANSI
// code carries a `[` of its own — so reading from the first `[` in the output lands inside an
// escape sequence. It matters here more than most: the caller runs between a migration and the data
// it has to write.

const ESC = '\u001b';
const banner = [
  `${ESC}[90m├${ESC}[39m Checking if file needs uploading`,
  `${ESC}[90m│${ESC}[39m`,
  `${ESC}[90m├${ESC}[39m 🌀 Uploading 7018ade7-a84e-443d-bc0e-baeb72f24f06.3f6dddb2a67ff2ba.sql`,
  `${ESC}[90m│${ESC}[39m 🌀 Uploading complete.`,
  `${ESC}[90m│${ESC}[39m`,
].join('\n');

const payload = (results) => `${JSON.stringify([{ results, success: true }], null, 2)}\n`;

describe('parseD1Json', () => {
  it('reads the rows out of a plain --command run', () => {
    expect(parseD1Json(payload([{ n: 3 }]))).toEqual([{ n: 3 }]);
  });

  it('reads them past the coloured upload banner a --file run prints', () => {
    expect(parseD1Json(`${banner}\n${payload([{ id: 'a', k0: 'dn1:1.1' }])}`)).toEqual([{ id: 'a', k0: 'dn1:1.1' }]);
  });

  it('reads them when the colour codes have lost their escape byte', () => {
    expect(parseD1Json(`[90m├[39m Uploading\n${payload([{ n: 1 }])}`)).toEqual([{ n: 1 }]);
  });

  it('returns nothing for a statement that answers with no rows', () => {
    expect(parseD1Json(payload([]))).toEqual([]);
    expect(parseD1Json(`${JSON.stringify([{ success: true }])}\n`)).toEqual([]);
  });

  // Failing loudly matters more than usual here: the caller runs between a migration and the data
  // it has to write, so a silent empty result would read as "nothing to do".
  it('throws rather than returning nothing when there is no payload at all', () => {
    expect(() => parseD1Json('✘ [ERROR] no such table: highlights')).toThrow(/No JSON/);
    expect(() => parseD1Json('')).toThrow(/No JSON/);
  });
});
