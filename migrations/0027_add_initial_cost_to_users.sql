-- Add initial_cost column to USERS table
ALTER TABLE USERS ADD COLUMN initial_cost REAL DEFAULT 0;
