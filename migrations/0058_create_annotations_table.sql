-- Create ANNOTATIONS table (one per user per year)
CREATE TABLE IF NOT EXISTS ANNOTATIONS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    year INTEGER NOT NULL DEFAULT 2026,
    description TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(owner_id, year)
);

-- Create ANNOTATION_ITEMS table (symbol + amount pairs)
CREATE TABLE IF NOT EXISTS ANNOTATION_ITEMS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    annotation_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    amount REAL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (annotation_id) REFERENCES ANNOTATIONS(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_annotations_owner_year ON ANNOTATIONS(owner_id, year);
CREATE INDEX IF NOT EXISTS idx_annotation_items_annotation_id ON ANNOTATION_ITEMS(annotation_id);
