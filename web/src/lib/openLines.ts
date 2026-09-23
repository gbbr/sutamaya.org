import { OPEN_LINES_KEY } from './storageKeys';

// The Pali lines and notes a reader leaves open in each sutta, kept so a return to it reopens them
// along with its scroll position.

/** A sutta's open lines: the segments whose Pali or note shows, by index. */
export type OpenLines = { pali: Record<number, boolean>; notes: Record<number, boolean> };

// Returns every sutta's kept lines, by sutta id.
function readKept(): Record<string, OpenLines> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_LINES_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** Returns the lines left open in a sutta, none when it had none. */
export function keptOpenLines(suttaId: string): OpenLines {
  return readKept()[suttaId] ?? { pali: {}, notes: {} };
}

// Returns the entries of `lines` that are open.
function openOnly(lines: Record<number, boolean>): Record<number, boolean> {
  return Object.fromEntries(Object.entries(lines).filter(([, open]) => open));
}

/** Records the lines open in a sutta, forgetting the sutta once none are. */
export function keepOpenLines(suttaId: string, lines: OpenLines) {
  const kept = readKept();
  const open = { pali: openOnly(lines.pali), notes: openOnly(lines.notes) };
  if (Object.keys(open.pali).length || Object.keys(open.notes).length) kept[suttaId] = open;
  else if (suttaId in kept) delete kept[suttaId];
  else return;
  try {
    localStorage.setItem(OPEN_LINES_KEY, JSON.stringify(kept));
  } catch {
    // storage unavailable — a return opens with its lines closed
  }
}
