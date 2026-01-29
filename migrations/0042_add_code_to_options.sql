-- Add code field to OPTIONS table
-- This field will store a 5-character unique identifier for each option trade

-- Step 1: Add the code column
ALTER TABLE OPTIONS ADD COLUMN code TEXT;

-- Step 2: Create unique index
CREATE UNIQUE INDEX idx_options_code ON OPTIONS(code);
