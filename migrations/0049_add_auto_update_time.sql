-- Migration: Add auto_update_time to USERS table
-- This stores the time when market data should be automatically updated (format: HH:MM)

ALTER TABLE USERS ADD COLUMN auto_update_time TEXT DEFAULT '06:00';
