-- Add cash_balance column to DAILY_NET_EQUITY table
ALTER TABLE DAILY_NET_EQUITY ADD COLUMN cash_balance REAL;

-- Set default value to 0 for existing records
UPDATE DAILY_NET_EQUITY 
SET cash_balance = 0 
WHERE cash_balance IS NULL;
