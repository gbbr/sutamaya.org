import { describe, expect, it } from 'vitest';
import { derivePaneViewSync } from './paneView';

const base = {
  isFirstRun: false,
  restoreOrigin: false,
  returningToSameNode: false,
  nodeId: 'dn1',
  nodeIsListId: false,
  nodeIsCorpusNode: true,
};

describe('derivePaneViewSync', () => {
  it('switches to lists when nodeId is a list id', () => {
    expect(derivePaneViewSync({ ...base, nodeIsListId: true, nodeIsCorpusNode: false })).toBe('lists');
  });

  it('switches to library when nodeId is a corpus node', () => {
    expect(derivePaneViewSync({ ...base, nodeIsListId: false, nodeIsCorpusNode: true })).toBe('library');
  });

  it('prefers lists when nodeId is somehow both (list id wins)', () => {
    expect(derivePaneViewSync({ ...base, nodeIsListId: true, nodeIsCorpusNode: true })).toBe('lists');
  });

  it('does nothing on the very first run of a reader-close round trip', () => {
    expect(derivePaneViewSync({ ...base, isFirstRun: true, restoreOrigin: true, nodeIsListId: true })).toBeNull();
  });

  it('still syncs on first run when it is not a restore-origin round trip', () => {
    expect(derivePaneViewSync({ ...base, isFirstRun: true, restoreOrigin: false, nodeIsListId: true, nodeIsCorpusNode: false })).toBe(
      'lists'
    );
  });

  it('does nothing on a later run even if restoreOrigin is (still) true', () => {
    expect(derivePaneViewSync({ ...base, isFirstRun: false, restoreOrigin: true, nodeIsListId: true, nodeIsCorpusNode: false })).toBe(
      'lists'
    );
  });

  it('does nothing on the first run of a return to the node already being browsed', () => {
    // Settings and back, or a refresh, while "My lists" was showing: nodeId is still the corpus
    // node the toggle was flipped away from, and syncing on it would snap the pane to Library.
    expect(derivePaneViewSync({ ...base, isFirstRun: true, returningToSameNode: true })).toBeNull();
  });

  it('still syncs on a later run when the node has stayed the same', () => {
    // A selection made in the pane itself — the flag describes the mount, not every render.
    expect(derivePaneViewSync({ ...base, isFirstRun: false, returningToSameNode: true })).toBe('library');
  });

  it('does nothing without a nodeId', () => {
    expect(derivePaneViewSync({ ...base, nodeId: undefined })).toBeNull();
  });

  it('does nothing when nodeId resolves to neither a list nor a corpus node', () => {
    expect(derivePaneViewSync({ ...base, nodeIsListId: false, nodeIsCorpusNode: false })).toBeNull();
  });
});
