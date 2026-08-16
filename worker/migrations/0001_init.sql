CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  google_id   TEXT NOT NULL UNIQUE,
  name        TEXT,
  picture     TEXT,
  created_at  TEXT NOT NULL          -- ISO 8601 string, same as Firestore stored
);

-- `items` stays a JSON array rather than becoming a join table, deliberately: it keeps
-- reconcileItemOrder() and assembleUserData() portable verbatim, and SQLite's JSON1 functions
-- express arrayUnion/arrayRemove as single atomic statements anyway (see the translation table
-- in the migration plan). `position` is routinely negative — new entries are prepended via
-- firstPosition().
CREATE TABLE lists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  parent_id   TEXT,
  kind        TEXT NOT NULL DEFAULT 'list',   -- 'list' | 'group'
  position    INTEGER NOT NULL,
  items       TEXT NOT NULL DEFAULT '[]',     -- JSON array of sutta uids, in user order
  created_at  TEXT NOT NULL
);
CREATE INDEX lists_user_position ON lists(user_id, position);
CREATE INDEX lists_user_parent   ON lists(user_id, parent_id);

CREATE TABLE notes (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sutta_id    TEXT NOT NULL,
  text        TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, sutta_id)
);

CREATE TABLE highlights (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sutta_id    TEXT NOT NULL,
  i           INTEGER NOT NULL,   -- segment index
  s           INTEGER NOT NULL,   -- half-open [s, e) char range within the segment
  e           INTEGER NOT NULL,
  color       TEXT NOT NULL,
  g           TEXT NOT NULL,      -- groupId shared by one PUT /highlights/ranges call
  created_at  TEXT NOT NULL
);
CREATE INDEX highlights_user_sutta ON highlights(user_id, sutta_id);

CREATE TABLE visited (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sutta_id    TEXT NOT NULL,
  visited_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, sutta_id)
);
