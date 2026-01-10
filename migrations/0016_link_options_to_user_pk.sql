-- Add owner_id to OPTIONS table
ALTER TABLE OPTIONS ADD COLUMN owner_id INTEGER;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_options_owner_id ON OPTIONS(owner_id);

-- Backfill owner_id based on user_id
-- We need to join USERS and OPTIONS on user_id to find the correct USERS.id
UPDATE OPTIONS
SET owner_id = (SELECT id FROM USERS WHERE USERS.user_id = OPTIONS.user_id OR (OPTIONS.user_id IS NULL AND USERS.user_id IS NULL));
