-- Add google_id column to USERS (for Google OAuth)
-- This column was previously added directly and not tracked by a migration.
-- Migration 0056 expects this column to exist when rebuilding the table.
ALTER TABLE USERS ADD COLUMN google_id TEXT;
