-- Migration: Add transaction_type column to DEPOSITS table
-- This enables tracking both deposits (入金) and withdrawals (出金)

-- Add transaction_type column with default value 'deposit'
ALTER TABLE DEPOSITS ADD COLUMN transaction_type TEXT DEFAULT 'deposit';

-- Create index for faster filtering by transaction type
CREATE INDEX IF NOT EXISTS idx_deposits_transaction_type ON DEPOSITS(transaction_type);

-- Update any existing records to have 'deposit' as transaction_type
-- (This is redundant given the DEFAULT, but ensures consistency)
UPDATE DEPOSITS SET transaction_type = 'deposit' WHERE transaction_type IS NULL;
