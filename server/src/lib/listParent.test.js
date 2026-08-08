import { describe, expect, it } from 'vitest';
import { invalidParentReasonForDoc, wouldCreateCycle } from './listParent.js';

function fakeDoc(exists, data) {
  return { exists, data: () => data };
}

describe('invalidParentReasonForDoc', () => {
  it('rejects a parent that does not exist', () => {
    expect(invalidParentReasonForDoc(fakeDoc(false, undefined))).toBe('Parent not found.');
  });

  it('rejects a parent that is a plain list, not a group', () => {
    expect(invalidParentReasonForDoc(fakeDoc(true, { kind: 'list' }))).toBe('Only a group can contain other lists.');
  });

  it('rejects a parent with no kind field (defaults to list)', () => {
    expect(invalidParentReasonForDoc(fakeDoc(true, {}))).toBe('Only a group can contain other lists.');
  });

  it('accepts a parent that is a group', () => {
    expect(invalidParentReasonForDoc(fakeDoc(true, { kind: 'group' }))).toBeNull();
  });
});

describe('wouldCreateCycle', () => {
  const tree = [
    { id: 'g1', parentId: null },
    { id: 'g2', parentId: 'g1' },
    { id: 'g3', parentId: 'g2' },
    { id: 'l1', parentId: 'g1' },
  ];

  it('is false for moving to the top level', () => {
    expect(wouldCreateCycle('g2', null, tree)).toBe(false);
  });

  it('is true for a list set as its own parent', () => {
    expect(wouldCreateCycle('g1', 'g1', tree)).toBe(true);
  });

  it('is true for moving a group under its own direct child', () => {
    expect(wouldCreateCycle('g1', 'g2', tree)).toBe(true);
  });

  it('is true for moving a group under a deeper descendant', () => {
    expect(wouldCreateCycle('g1', 'g3', tree)).toBe(true);
  });

  it('is false for moving a list under an unrelated group', () => {
    expect(wouldCreateCycle('l1', 'g2', tree)).toBe(false);
  });

  it('is false for moving a group under its own parent (no-op reparent)', () => {
    expect(wouldCreateCycle('g2', 'g1', tree)).toBe(false);
  });

  it('is false for moving a leaf list around regardless of target', () => {
    expect(wouldCreateCycle('l1', 'g3', tree)).toBe(false);
  });
});
