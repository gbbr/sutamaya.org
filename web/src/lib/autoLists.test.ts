import { describe, expect, it } from 'vitest';
import {
  AUTO_LIST_CAP,
  HIGHLIGHTS_AUTO_LIST_ID,
  NOTES_AUTO_LIST_ID,
  RECENT_AUTO_LIST_ID,
} from './autoLists';
import {
  AUTO_LIST_CAP as WORKER_AUTO_LIST_CAP,
  HIGHLIGHTS_AUTO_LIST_ID as WORKER_HIGHLIGHTS_AUTO_LIST_ID,
  NOTES_AUTO_LIST_ID as WORKER_NOTES_AUTO_LIST_ID,
  RECENT_AUTO_LIST_ID as WORKER_RECENT_AUTO_LIST_ID,
  // @ts-expect-error -- plain-JS worker module, no .d.ts across the workspace boundary
} from '../../../worker/src/lib/userData.js';

// These constants are intentionally duplicated between the two npm workspaces (see the comments
// in both source files) since nothing else shares a module between web/ and worker/. This test
// is the tripwire: if either side changes without the other, this fails loudly instead of the
// two silently drifting (e.g. the client's optimistic cap no longer matching what the worker
// actually returns, which would change an auto-list's length the moment a sync lands).
describe('auto-list constants stay in sync between web and worker', () => {
  it('uses the same ids', () => {
    expect(RECENT_AUTO_LIST_ID).toBe(WORKER_RECENT_AUTO_LIST_ID);
    expect(HIGHLIGHTS_AUTO_LIST_ID).toBe(WORKER_HIGHLIGHTS_AUTO_LIST_ID);
    expect(NOTES_AUTO_LIST_ID).toBe(WORKER_NOTES_AUTO_LIST_ID);
  });

  it('uses the same cap', () => {
    expect(AUTO_LIST_CAP).toBe(WORKER_AUTO_LIST_CAP);
  });
});
