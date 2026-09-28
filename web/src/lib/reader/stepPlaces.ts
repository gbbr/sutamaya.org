import { STEP_PLACES_KEY } from '../storageKeys';

// Where the reader was in a sutta when a link or search hit took them to another line of it — the
// reading pane's scroll offset, by the history entry they left — so going back to that entry
// returns there. Kept for the tab's session, as its history is.

// readPlaces returns every kept offset, by history entry key.
function readPlaces(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STEP_PLACES_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** keepStepPlace records the scroll offset the history entry `key` was left at. */
export function keepStepPlace(key: string, scrollTop: number) {
  try {
    sessionStorage.setItem(STEP_PLACES_KEY, JSON.stringify({ ...readPlaces(), [key]: scrollTop }));
  } catch {
    // storage unavailable — going back leaves the reader where they are
  }
}

/** stepPlace returns the scroll offset the history entry `key` was left at, if one was kept. */
export function stepPlace(key: string): number | undefined {
  return readPlaces()[key];
}
