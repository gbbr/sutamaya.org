-- The put-aside set: one row per account holding the whole ordered set as JSON, not a row per
-- sutta. That is what keeps it free of tombstones — dropping a member is just a newer `entries`
-- that doesn't list it, so an older device pushing a stale set loses on `mtime` and can resurrect
-- nothing. There is deliberately no `deleted` column.
--
-- '' sorts below every real timestamp, so a row written before the client ever stamps one always
-- loses a merge rather than winning by accident.
CREATE TABLE put_aside (
  user_id TEXT PRIMARY KEY,
  entries TEXT NOT NULL DEFAULT '[]',
  mtime   TEXT NOT NULL DEFAULT ''
);
