-- Migration 0063: Remove UNIQUE(email, year) constraint definitively
-- Rebuild USERS table with ONLY UNIQUE(user_id, year) -> Updated to just remove index

DROP INDEX IF EXISTS idx_users_email_year;
