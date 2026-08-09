import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHTS_AUTO_LIST_ID,
  NOTES_AUTO_LIST_ID,
  RECENT_AUTO_LIST_CAP,
  RECENT_AUTO_LIST_ID,
} from './autoLists';
import {
  HIGHLIGHTS_AUTO_LIST_ID as SERVER_HIGHLIGHTS_AUTO_LIST_ID,
  NOTES_AUTO_LIST_ID as SERVER_NOTES_AUTO_LIST_ID,
  RECENT_AUTO_LIST_CAP as SERVER_RECENT_AUTO_LIST_CAP,
  RECENT_AUTO_LIST_ID as SERVER_RECENT_AUTO_LIST_ID,
  // @ts-expect-error -- plain-JS server module, no .d.ts across the workspace boundary
} from '../../../server/src/lib/userData.js';

// These constants are intentionally duplicated between the two npm workspaces (see the comments
// in both source files) since nothing else shares a module between web/ and server/. This test
// is the tripwire: if either side changes without the other, this fails loudly instead of the
// two silently drifting (e.g. the client's optimistic "Recent" cap no longer matching what the
// server actually returns).
describe('auto-list constants stay in sync between web and server', () => {
  it('uses the same ids', () => {
    expect(RECENT_AUTO_LIST_ID).toBe(SERVER_RECENT_AUTO_LIST_ID);
    expect(HIGHLIGHTS_AUTO_LIST_ID).toBe(SERVER_HIGHLIGHTS_AUTO_LIST_ID);
    expect(NOTES_AUTO_LIST_ID).toBe(SERVER_NOTES_AUTO_LIST_ID);
  });

  it('uses the same "Recent" cap', () => {
    expect(RECENT_AUTO_LIST_CAP).toBe(SERVER_RECENT_AUTO_LIST_CAP);
  });
});
