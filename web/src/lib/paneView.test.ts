import { describe, expect, it } from 'vitest';
import { derivePaneViewSync } from './paneView';

const base = {
  isFirstRun: false,
  restoreOrigin: false,
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

  it('does nothing without a nodeId', () => {
    expect(derivePaneViewSync({ ...base, nodeId: undefined })).toBeNull();
  });

  it('does nothing when nodeId resolves to neither a list nor a corpus node', () => {
    expect(derivePaneViewSync({ ...base, nodeIsListId: false, nodeIsCorpusNode: false })).toBeNull();
  });
});
