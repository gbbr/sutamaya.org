-- Highlights anchor on segment keys — SuttaCentral's own segment ids — instead of on a segment's
-- position in the document.
--
-- A position addresses a different line whenever the corpus gains or loses one, and a key addresses
-- the line itself, so a line added or removed moves no highlight but the one on it.
--
-- `k0`/`k1` land empty on the rows that predate them, because the conversion needs the corpus and
-- SQL has none of it: nothing here can turn position 42 into `mn10:2.7`. Those rows are keyed from
-- outside the database, from the positions read before this ran, and a client holding a mirror
-- written against the positions re-anchors it as the sutta's text loads
-- (web/src/lib/mirror.ts's anchorHighlights). A highlight with no key yet paints nothing and is
-- deleted by nothing.
--
-- A table rebuild rather than ADD COLUMN, so `i0`/`i1` — NOT NULL with no default, and meaningless
-- once a row is keyed — leave with the same statement that brings the keys in.

CREATE TABLE highlights_keyed (
  -- The client-minted id: one selection is one highlight, so its group id is its row id. Keyed with
  -- user_id rather than alone, so one account's ids can never collide with another's.
  id          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sutta_id    TEXT NOT NULL,
  -- Half-open: from (k0, o0) up to but not including (k1, o1), where `k` is a segment key and `o` a
  -- character offset into that segment's English text. k0 = k1 for a selection inside one segment.
  k0          TEXT NOT NULL DEFAULT '',
  o0          INTEGER NOT NULL,
  k1          TEXT NOT NULL DEFAULT '',
  o1          INTEGER NOT NULL,
  color       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  mtime       TEXT NOT NULL DEFAULT '',
  deleted     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

INSERT INTO highlights_keyed (id, user_id, sutta_id, k0, o0, k1, o1, color, created_at, mtime, deleted)
SELECT id, user_id, sutta_id, '', o0, '', o1, color, created_at, mtime, deleted FROM highlights;

DROP TABLE highlights;
ALTER TABLE highlights_keyed RENAME TO highlights;

CREATE INDEX highlights_user_sutta ON highlights(user_id, sutta_id);
