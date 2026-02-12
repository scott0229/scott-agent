-- Add fee_exempt_months column to USERS table
-- Tracks number of months exempt from management fee at the start of the year
ALTER TABLE USERS ADD COLUMN fee_exempt_months INTEGER DEFAULT 0;
