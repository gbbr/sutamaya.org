-- Highlights become one row per highlight, holding the span's two endpoints, instead of one row
-- per segment the highlight covers.
--
-- An interior row used to store `e` = that segment's length at the time of highlighting, so a
-- segment reworded longer upstream left its tail unhighlighted — a gap in the middle of the
-- highlight. Endpoints make an interior gap structurally impossible, and cover a segment inserted
-- mid-span too. The two endpoint segments still carry offsets a rewording moves; that is accepted
-- (docs/offline-sync.md).
--
-- A table rebuild rather than the usual additive columns: `i`, `s` and `e` are NOT NULL with no
-- default, so a new-shape insert that left them out would fail outright. There is nothing to
-- reconcile afterwards — a highlight is immutable, so every row of one carries the same colour,
-- created_at, mtime and deleted flag, and collapsing them loses nothing.

CREATE TABLE highlights_endpoints (
  -- The client-minted id (what the old rows called `g`): one selection is one highlight, so its
  -- group id is its row id. Keyed with user_id rather than alone, so one account's ids can never
  -- collide with another's — the same isolation the old (user_id, g, i) unique index gave.
  id          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sutta_id    TEXT NOT NULL,
  -- Half-open: from (i0, o0) up to but not including (i1, o1), where `i` is a segment index and `o`
  -- a character offset into that segment's English text. i0 === i1 for a selection inside one
  -- segment.
  i0          INTEGER NOT NULL,
  o0          INTEGER NOT NULL,
  i1          INTEGER NOT NULL,
  o1          INTEGER NOT NULL,
  color       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  mtime       TEXT NOT NULL DEFAULT '',
  deleted     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

-- One row per (user_id, g), carried by that group's first segment: its own (i, s) are the start,
-- and the last segment's (i, e) the end. Tombstoned groups collapse the same way, so an offline
-- device still can't resurrect one.
INSERT INTO highlights_endpoints (id, user_id, sutta_id, i0, o0, i1, o1, color, created_at, mtime, deleted)
SELECT
  h.g,
  h.user_id,
  h.sutta_id,
  h.i,
  h.s,
  (SELECT x.i FROM highlights x WHERE x.user_id = h.user_id AND x.g = h.g ORDER BY x.i DESC LIMIT 1),
  (SELECT x.e FROM highlights x WHERE x.user_id = h.user_id AND x.g = h.g ORDER BY x.i DESC LIMIT 1),
  h.color,
  h.created_at,
  h.mtime,
  h.deleted
FROM highlights h
WHERE h.i = (SELECT MIN(x.i) FROM highlights x WHERE x.user_id = h.user_id AND x.g = h.g);

DROP TABLE highlights;
ALTER TABLE highlights_endpoints RENAME TO highlights;

CREATE INDEX highlights_user_sutta ON highlights(user_id, sutta_id);
