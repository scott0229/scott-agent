-- Create TRADE_GROUPS table for managing group status
CREATE TABLE IF NOT EXISTS TRADE_GROUPS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(owner_id, year, name)
);
