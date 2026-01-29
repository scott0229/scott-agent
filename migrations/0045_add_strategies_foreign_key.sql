-- Add foreign key constraint to STRATEGIES table
-- Note: SQLite doesn't support adding foreign keys to existing tables directly
-- We need to recreate the table with the constraint

-- Step 1: Create new table with foreign key
CREATE TABLE IF NOT EXISTS STRATEGIES_NEW (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id TEXT, -- For API reference (user_id string)
    owner_id INTEGER, -- Link to USERS.id
    year INTEGER NOT NULL DEFAULT 2025,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (owner_id) REFERENCES USERS(id) ON DELETE CASCADE
);

-- Step 2: Copy existing data
INSERT INTO STRATEGIES_NEW (id, name, user_id, owner_id, year, created_at, updated_at)
SELECT id, name, user_id, owner_id, year, created_at, updated_at
FROM STRATEGIES
WHERE owner_id IN (SELECT id FROM USERS); -- Only copy strategies with valid owner_id

-- Step 3: Drop old table
DROP TABLE STRATEGIES;

-- Step 4: Rename new table
ALTER TABLE STRATEGIES_NEW RENAME TO STRATEGIES;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_strategies_owner_id ON STRATEGIES(owner_id);
CREATE INDEX IF NOT EXISTS idx_strategies_year ON STRATEGIES(year);
