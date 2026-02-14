-- Add option_strategy column to STRATEGIES table
-- Stores comma-separated values: 'Covered Call', 'Protective Put', or both
ALTER TABLE STRATEGIES ADD COLUMN option_strategy TEXT DEFAULT NULL;
