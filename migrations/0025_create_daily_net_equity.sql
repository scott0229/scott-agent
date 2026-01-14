-- Create DAILY_NET_EQUITY table
CREATE TABLE IF NOT EXISTS DAILY_NET_EQUITY (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date INTEGER NOT NULL, -- Unix timestamp at 00:00:00 UTC
    net_equity REAL NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES USERS(id) ON DELETE CASCADE,
    UNIQUE(user_id, date)
);

-- Index for faster range queries
CREATE INDEX IF NOT EXISTS idx_daily_net_equity_user_date ON DAILY_NET_EQUITY(user_id, date);
