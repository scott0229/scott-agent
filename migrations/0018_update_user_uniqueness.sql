-- Migration: Update user uniqueness constraints to be year-scoped
-- This allows same email/user_id to exist in different years

-- 1. Create new table with updated constraints
CREATE TABLE USERS_NEW (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    user_id TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'customer',
    name TEXT,
    management_fee REAL DEFAULT 4.0,
    ib_account TEXT,
    phone TEXT,
    year INTEGER NOT NULL DEFAULT 2025,
    UNIQUE(email, year),
    UNIQUE(user_id, year)
);

-- 2. Copy data from old table to new table
INSERT INTO USERS_NEW (
    id, email, password, created_at, updated_at, 
    user_id, avatar_url, role, name, 
    management_fee, ib_account, phone, year
)
SELECT 
    id, email, password, created_at, updated_at, 
    user_id, avatar_url,role, name, 
    management_fee, ib_account, phone, year
FROM USERS;

-- 3. Drop old table
DROP TABLE USERS;

-- 4. Rename new table
ALTER TABLE USERS_NEW RENAME TO USERS;

-- 5. Recreate indexes
CREATE INDEX idx_users_year ON USERS(year);
CREATE INDEX idx_users_year_role ON USERS(year, role);
-- Note: UNIQUE indexes are already created by the UNIQUE constraints in CREATE TABLE
