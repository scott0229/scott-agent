-- Add initial_interest column to USERS table for year-start interest tracking
ALTER TABLE USERS ADD COLUMN initial_interest REAL DEFAULT 0;
