-- Migration: Fix Staging Schema - Re-apply Unique Constraints (Safe Mode)
-- Modified to avoid DROP TABLE which causes Foreign Key violations in local dev context.

-- 1. Ensure new indexes exist
CREATE INDEX IF NOT EXISTS idx_users_year ON USERS(year);
CREATE INDEX IF NOT EXISTS idx_users_year_role ON USERS(year, role);

-- 2. Add user_id + year unique constraint (via index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id_year ON USERS(user_id, year);

-- 3. Add email + year unique constraint (via index)
-- Note: If a global UNIQUE(email) constraint exists on the table, this doesn't remove it.
-- But it ensures we at least have the year-scoped index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_year ON USERS(email, year);
