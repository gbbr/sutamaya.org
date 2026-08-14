// Character caps for user-entered free text, mirroring web/src/lib/textLimits.ts — enforced here
// too (not just client-side) so a request that bypasses the capped UI inputs can't write an
// unbounded list/group name or note.
export const LIST_NAME_MAX_LENGTH = 50;
export const NOTE_MAX_LENGTH = 500;
