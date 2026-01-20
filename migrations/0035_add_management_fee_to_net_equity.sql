-- Add management_fee column to DAILY_NET_EQUITY table
ALTER TABLE DAILY_NET_EQUITY ADD COLUMN management_fee REAL DEFAULT 0;

-- Drop obsolete monthly_fees table
DROP TABLE IF EXISTS monthly_fees;
