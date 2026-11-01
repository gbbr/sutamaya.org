-- The translation whose English a highlight's offsets count in: 'bodhi' or 'thanissaro', or NULL
-- for Sujato's (docs/offline-sync.md's "Highlights").

ALTER TABLE highlights ADD COLUMN translator TEXT;
