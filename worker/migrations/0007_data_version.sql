-- The account's data version, which GET /api/data tags its snapshot with and answers "not modified"
-- against (docs/offline-sync.md's "The flush").

ALTER TABLE users ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0;

-- Raise it on every insert, update and delete in each table the snapshot reads, whatever made the
-- change. routes/__tests__/data.test.js fails for a table the snapshot reads without all three.

CREATE TRIGGER lists_data_version_insert AFTER INSERT ON lists
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER lists_data_version_update AFTER UPDATE ON lists
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER lists_data_version_delete AFTER DELETE ON lists
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER notes_data_version_insert AFTER INSERT ON notes
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER notes_data_version_update AFTER UPDATE ON notes
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER notes_data_version_delete AFTER DELETE ON notes
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER highlights_data_version_insert AFTER INSERT ON highlights
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER highlights_data_version_update AFTER UPDATE ON highlights
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER highlights_data_version_delete AFTER DELETE ON highlights
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER visited_data_version_insert AFTER INSERT ON visited
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER visited_data_version_update AFTER UPDATE ON visited
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER visited_data_version_delete AFTER DELETE ON visited
BEGIN
  UPDATE users SET data_version = data_version + 1 WHERE id = OLD.user_id;
END;
