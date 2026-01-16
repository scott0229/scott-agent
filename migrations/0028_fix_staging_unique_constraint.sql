-- Migration: Fix Staging Schema - Re-apply Unique Constraints
-- This is necessary because 0018 apparently failed to drop the old table correctly on Staging,
-- leaving the global unique constraint on email.

PRAGMA foreign_keys = OFF;

-- Ensure step 1: Clean slate for new table
DROP TABLE IF EXISTS USERS_NEW_FIX;

-- 2. Create new table (Latest Schema state including initial_cost)
CREATE TABLE USERS_NEW_FIX (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    user_id TEXT,
    avatar_url TEXT,
    google_id TEXT,
    role TEXT NOT NULL DEFAULT 'customer',
    name TEXT,
    management_fee REAL DEFAULT 4.0,
    ib_account TEXT,
    phone TEXT,
    year INTEGER NOT NULL DEFAULT 2025,
    initial_cost REAL DEFAULT 0,
    UNIQUE(email, year),
    UNIQUE(user_id, year),
    UNIQUE(google_id, year)
);

-- 3. Copy data from current USERS
INSERT INTO USERS_NEW_FIX (
    id, email, password, created_at, updated_at, 
    user_id, avatar_url, google_id, role, name, 
    management_fee, ib_account, phone, year, initial_cost
)
SELECT 
    id, email, password, created_at, updated_at, 
    user_id, avatar_url, google_id, role, name, 
    management_fee, ib_account, phone, year, initial_cost
FROM USERS;

-- 4. Drop old table
DROP TABLE USERS;

-- 5. Rename
ALTER TABLE USERS_NEW_FIX RENAME TO USERS;

-- 6. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_users_year ON USERS(year);
CREATE INDEX IF NOT EXISTS idx_users_year_role ON USERS(year, role);

PRAGMA foreign_keys = ON;
