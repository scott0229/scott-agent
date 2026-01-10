-- Add user_id to OPTIONS table
ALTER TABLE OPTIONS ADD COLUMN user_id TEXT;
-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_options_user_id ON OPTIONS(user_id);
