-- Recreate ANNOTATIONS table without NOT NULL constraints on user_id/owner_id
-- and without the UNIQUE(owner_id, year) constraint since owners are now in ANNOTATION_OWNERS
-- IMPORTANT: Backup child tables first to avoid ON DELETE CASCADE data loss

-- Step 1: Backup child tables
CREATE TABLE IF NOT EXISTS ANNOTATION_ITEMS_BACKUP AS SELECT * FROM ANNOTATION_ITEMS;
CREATE TABLE IF NOT EXISTS ANNOTATION_OWNERS_BACKUP AS SELECT * FROM ANNOTATION_OWNERS;

-- Step 2: Create new table without constraints
CREATE TABLE IF NOT EXISTS ANNOTATIONS_NEW (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    owner_id INTEGER,
    year INTEGER NOT NULL DEFAULT 2026,
    description TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Step 3: Copy data
INSERT INTO ANNOTATIONS_NEW (id, user_id, owner_id, year, description, created_at, updated_at)
SELECT id, user_id, owner_id, year, description, created_at, updated_at FROM ANNOTATIONS;

-- Step 4: Drop old table (this will cascade delete items/owners)
DROP TABLE ANNOTATIONS;

-- Step 5: Rename new table
ALTER TABLE ANNOTATIONS_NEW RENAME TO ANNOTATIONS;

-- Step 6: Recreate index
CREATE INDEX IF NOT EXISTS idx_annotations_year ON ANNOTATIONS(year);

-- Step 7: Restore child table data from backups
INSERT OR IGNORE INTO ANNOTATION_ITEMS (id, annotation_id, symbol, amount, created_at)
SELECT id, annotation_id, symbol, amount, created_at FROM ANNOTATION_ITEMS_BACKUP;

INSERT OR IGNORE INTO ANNOTATION_OWNERS (id, annotation_id, owner_id, user_id)
SELECT id, annotation_id, owner_id, user_id FROM ANNOTATION_OWNERS_BACKUP;

-- Step 8: Drop backup tables
DROP TABLE IF EXISTS ANNOTATION_ITEMS_BACKUP;
DROP TABLE IF EXISTS ANNOTATION_OWNERS_BACKUP;
