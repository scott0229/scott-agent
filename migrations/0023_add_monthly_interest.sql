-- Create monthly_interest table to store interest data for each user by month
CREATE TABLE IF NOT EXISTS monthly_interest (
    user_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL, -- 1-12
    interest REAL NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, year, month),
    FOREIGN KEY (user_id) REFERENCES USERS(id) ON DELETE CASCADE
);

CREATE INDEX idx_monthly_interest_user_year ON monthly_interest(user_id, year);
