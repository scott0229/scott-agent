-- Migration: Update user uniqueness constraints to be year-scoped
-- This allows same email/user_id to exist in different years

-- 1. Create unique indexes for year-scoped constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_year ON USERS(email, year);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id_year ON USERS(user_id, year);
