-- Add deposit_type column to DEPOSITS table
ALTER TABLE DEPOSITS ADD COLUMN deposit_type TEXT DEFAULT 'cash';

-- Add index for deposit_type
CREATE INDEX IF NOT EXISTS idx_deposits_type ON DEPOSITS(deposit_type);
