-- Add trade_time field to OPTIONS table
-- Stores the execution time of the trade (HH:MM:SS format, e.g. '09:38:43')
ALTER TABLE OPTIONS ADD COLUMN trade_time TEXT;
