import { describe, expect, it } from 'vitest';
import { invalidParentReasonForDoc } from './listParent.js';

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
