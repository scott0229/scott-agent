-- Create DEPOSITS table for tracking user deposits
CREATE TABLE IF NOT EXISTS DEPOSITS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deposit_date INTEGER NOT NULL, -- Unix timestamp for the deposit date
    user_id INTEGER NOT NULL, -- Reference to USERS table
    amount REAL NOT NULL, -- Deposit amount
    year INTEGER NOT NULL, -- Year for filtering (extracted from deposit_date)
    note TEXT, -- Optional note
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_by INTEGER REFERENCES USERS(id),
    FOREIGN KEY (user_id) REFERENCES USERS(id) ON DELETE CASCADE
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_deposits_user ON DEPOSITS(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_date ON DEPOSITS(deposit_date);
CREATE INDEX IF NOT EXISTS idx_deposits_year ON DEPOSITS(year);
