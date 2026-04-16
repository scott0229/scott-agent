CREATE TABLE IF NOT EXISTS report_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    bucket_key TEXT NOT NULL,
    statement_date TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_archives_statement_date ON report_archives(statement_date);
