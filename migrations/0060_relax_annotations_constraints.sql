-- Recreate ANNOTATIONS table without NOT NULL constraints on user_id/owner_id
-- and without the UNIQUE(owner_id, year) constraint since owners are now in ANNOTATION_OWNERS

-- Step 1: Create new table without constraints
CREATE TABLE IF NOT EXISTS ANNOTATIONS_NEW (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    owner_id INTEGER,
    year INTEGER NOT NULL DEFAULT 2026,
    description TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Step 2: Copy data
INSERT INTO ANNOTATIONS_NEW (id, user_id, owner_id, year, description, created_at, updated_at)
SELECT id, user_id, owner_id, year, description, created_at, updated_at FROM ANNOTATIONS;

-- Step 3: Drop old table
DROP TABLE ANNOTATIONS;

-- Step 4: Rename new table
ALTER TABLE ANNOTATIONS_NEW RENAME TO ANNOTATIONS;

-- Step 5: Recreate index (without UNIQUE constraint)
CREATE INDEX IF NOT EXISTS idx_annotations_year ON ANNOTATIONS(year);
