-- Migration: Remove UNIQUE(ib_account, year) constraint
-- Multiple accounts can share the same year without an IB account (ib_account = NULL)

DROP INDEX IF EXISTS idx_users_ib_account_year;
