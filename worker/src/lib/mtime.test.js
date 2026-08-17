import { describe, expect, it } from 'vitest';
import { resolveMtime } from './mtime.js';

const SERVER_MTIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|server$/;

describe('resolveMtime', () => {
  it('passes a well-formed client mtime through untouched', () => {
    expect(resolveMtime('2026-08-17T10:00:00.000Z|phone')).toBe('2026-08-17T10:00:00.000Z|phone');
  });

  it('generates a server mtime when the client sends none', () => {
    expect(resolveMtime(undefined)).toMatch(SERVER_MTIME);
    expect(resolveMtime(null)).toMatch(SERVER_MTIME);
    expect(resolveMtime('')).toMatch(SERVER_MTIME);
    expect(resolveMtime(12345)).toMatch(SERVER_MTIME);
  });

  // Comparison is lexicographic, so any of these would outrank every real timestamp and freeze
  // the row against all future writes — permanently, since a rejected write is a silent no-op.
  it.each([
    ['not a timestamp at all', 'zzz'],
    ['a bare device id', '|phone'],
    ['no device id', '2026-08-17T10:00:00.000Z'],
    ['an empty device id', '2026-08-17T10:00:00.000Z|'],
    ['second precision, not millisecond', '2026-08-17T10:00:00Z|phone'],
    ['a local timestamp with no Z', '2026-08-17T10:00:00.000|phone'],
    ['leading whitespace', ' 2026-08-17T10:00:00.000Z|phone'],
  ])('falls back to a server mtime for %s', (_label, malformed) => {
    expect(resolveMtime(malformed)).toMatch(SERVER_MTIME);
  });

  it('never returns the same value twice, so two writes in one millisecond cannot tie', () => {
    const generated = Array.from({ length: 50 }, () => resolveMtime(undefined));
    expect(new Set(generated).size).toBe(generated.length);
    expect([...generated]).toEqual([...generated].sort());
  });
});
