-- Migration: Add year column for data isolation
-- This allows each year to have its own independent set of users and transactions

-- Add year column to USERS table
ALTER TABLE USERS ADD COLUMN year INTEGER NOT NULL DEFAULT 2025;

-- Add year column to OPTIONS table
ALTER TABLE OPTIONS ADD COLUMN year INTEGER NOT NULL DEFAULT 2025;

-- Create indexes for performance
CREATE INDEX idx_users_year ON USERS(year);
CREATE INDEX idx_users_year_role ON USERS(year, role);
CREATE INDEX idx_options_year ON OPTIONS(year);
CREATE INDEX idx_options_year_owner ON OPTIONS(year, owner_id);

-- Set all existing data to 2025
-- This ensures existing users and transactions are preserved in 2025
UPDATE USERS SET year = 2025 WHERE year IS NULL OR year = 0;
UPDATE OPTIONS SET year = 2025 WHERE year IS NULL OR year = 0;
