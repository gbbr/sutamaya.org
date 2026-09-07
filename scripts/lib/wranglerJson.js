// The rows out of `wrangler d1 execute --json`.
//
// Wrangler writes a progress banner before the payload and colours it, and an ANSI colour code
// carries a `[` of its own — so the payload is found after those codes are stripped, by the one
// thing the banner never has: a line beginning with `[`.

// The escape byte is optional: a colour code survives some pipes with it already removed, leaving
// the bare `[90m` that would otherwise read as the start of the payload.
const ANSI = /\u001b?\[[0-9;]*m/g;

export function parseD1Json(output) {
  const plain = String(output).replace(ANSI, '');
  const start = plain.search(/^\[/m);
  if (start === -1) throw new Error(`No JSON in wrangler's output:\n${plain.trim()}`);
  return JSON.parse(plain.slice(start))[0]?.results ?? [];
}
