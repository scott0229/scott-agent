-- Add operation_mode column to USERS table
-- Values: '調倉為主' or '權利金為主'
ALTER TABLE USERS ADD COLUMN operation_mode TEXT DEFAULT NULL;
