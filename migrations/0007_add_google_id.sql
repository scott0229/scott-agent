-- Add google_id column to USERS table
ALTER TABLE USERS ADD COLUMN google_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON USERS(google_id);
