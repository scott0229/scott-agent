-- Migration 0063: Remove UNIQUE(email, year) constraint definitively
-- Rebuild USERS table with ONLY UNIQUE(user_id, year)

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS USERS_REBUILD (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    password TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    user_id TEXT,
    avatar_url TEXT,
    google_id TEXT,
    role TEXT DEFAULT 'customer',
    name TEXT,
    management_fee REAL DEFAULT 4.0,
    ib_account TEXT,
    phone TEXT,
    year INTEGER DEFAULT 2026,
    initial_cost REAL DEFAULT 0,
    initial_cash REAL DEFAULT 0,
    initial_management_fee REAL DEFAULT 0,
    initial_deposit REAL DEFAULT 0,
    api_key TEXT,
    auto_update_time TEXT DEFAULT '06:00',
    last_auto_update_time INTEGER,
    last_auto_update_status TEXT,
    last_auto_update_message TEXT,
    initial_interest REAL DEFAULT 0,
    start_date TEXT,
    fee_exempt_months INTEGER DEFAULT 0,
    UNIQUE(user_id, year)
);

INSERT INTO USERS_REBUILD (
    id, email, password, created_at, updated_at,
    user_id, avatar_url, google_id, role, name,
    management_fee, ib_account, phone, year,
    initial_cost, initial_cash, initial_management_fee, initial_deposit,
    api_key, auto_update_time, last_auto_update_time, last_auto_update_status, last_auto_update_message,
    initial_interest, start_date, fee_exempt_months
)
SELECT
    id, email, password, created_at, updated_at,
    user_id, avatar_url, google_id, role, name,
    management_fee, ib_account, phone, year,
    initial_cost, initial_cash, initial_management_fee, initial_deposit,
    api_key, auto_update_time, last_auto_update_time, last_auto_update_status, last_auto_update_message,
    initial_interest, start_date, fee_exempt_months
FROM USERS;

DROP TABLE USERS;

ALTER TABLE USERS_REBUILD RENAME TO USERS;

CREATE INDEX IF NOT EXISTS idx_users_year ON USERS(year);
CREATE INDEX IF NOT EXISTS idx_users_year_role ON USERS(year, role);

PRAGMA foreign_keys = ON;
