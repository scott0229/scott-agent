-- Migration: Update user uniqueness constraints
-- Remove UNIQUE(email, year) to allow same email for multiple accounts
-- Keep UNIQUE(user_id, year) as the primary login identifier
-- Add UNIQUE(ib_account, year) as the business key for IB accounts

PRAGMA foreign_keys = OFF;

CREATE TABLE USERS_NEW (
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
    UNIQUE(user_id, year),
    UNIQUE(ib_account, year)
);

INSERT INTO USERS_NEW (
    id, email, password, created_at, updated_at,
    user_id, avatar_url, google_id, role, name,
    management_fee, ib_account, phone, year,
    initial_cost, initial_cash, initial_management_fee, initial_deposit,
    api_key, auto_update_time, last_auto_update_time, last_auto_update_status, last_auto_update_message,
    initial_interest, start_date
)
SELECT
    id, email, password, created_at, updated_at,
    user_id, avatar_url, google_id, role, name,
    management_fee, ib_account, phone, year,
    initial_cost, initial_cash, initial_management_fee, initial_deposit,
    api_key, auto_update_time, last_auto_update_time, last_auto_update_status, last_auto_update_message,
    initial_interest, start_date
FROM USERS;

DROP TABLE USERS;

ALTER TABLE USERS_NEW RENAME TO USERS;

CREATE INDEX idx_users_year ON USERS(year);
CREATE INDEX idx_users_year_role ON USERS(year, role);

PRAGMA foreign_keys = ON;
