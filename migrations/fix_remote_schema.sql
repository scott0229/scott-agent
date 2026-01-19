PRAGMA foreign_keys=OFF;

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
    UNIQUE(user_id, year),
    UNIQUE(email, year)
);

INSERT INTO USERS_NEW (
    id, email, password, created_at, updated_at, user_id, avatar_url, google_id, role, name, management_fee, ib_account, phone, year, initial_cost
)
SELECT 
    id, email, password, created_at, updated_at, user_id, avatar_url, google_id, role, name, management_fee, ib_account, phone, year, initial_cost
FROM USERS;

DROP TABLE USERS;
ALTER TABLE USERS_NEW RENAME TO USERS;

CREATE INDEX idx_users_year ON USERS(year);
CREATE INDEX idx_users_year_role ON USERS(year, role);

PRAGMA foreign_keys=ON;
