-- Add auto-update execution log fields to USERS table
-- SQLite requires separate ALTER TABLE statements for each column
ALTER TABLE USERS ADD COLUMN last_auto_update_time INTEGER;
ALTER TABLE USERS ADD COLUMN last_auto_update_status TEXT;
ALTER TABLE USERS ADD COLUMN last_auto_update_message TEXT;
