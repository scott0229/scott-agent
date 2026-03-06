-- Migration: Update user uniqueness constraints
-- Remove UNIQUE(email, year) to allow same email for multiple accounts
-- Keep UNIQUE(user_id, year) as the primary login identifier
-- Add UNIQUE(ib_account, year) as the business key for IB accounts

-- 1. Drop the old unique index on email, year
DROP INDEX IF EXISTS idx_users_email_year;

-- 2. Create the new unique index on ib_account, year
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ib_account_year ON USERS(ib_account, year);
