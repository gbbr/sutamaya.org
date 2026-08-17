-- SQLite requires a non-null default when adding a NOT NULL column. '' sorts below every real
-- timestamp, so an un-backfilled row always loses a merge rather than winning by accident.
ALTER TABLE lists      ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE lists      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notes      ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE notes      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE highlights ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE highlights ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

-- `visited` needs neither: visited_at already is the timestamp, and it is never deleted.

-- Backfill so existing rows carry a real, ordered mtime rather than ''.
UPDATE lists      SET mtime = created_at WHERE mtime = '';
UPDATE notes      SET mtime = updated_at WHERE mtime = '';
UPDATE highlights SET mtime = created_at WHERE mtime = '';

-- A group is written as one row per segment; (user_id, g, i) is its natural key and what makes
-- re-pushing a group an INSERT OR IGNORE no-op. Load-bearing, not an optimisation.
CREATE UNIQUE INDEX highlights_user_group_seg ON highlights(user_id, g, i);
