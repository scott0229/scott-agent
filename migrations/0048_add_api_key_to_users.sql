-- Add api_key column to USERS table to store user-specific Alpha Vantage API keys
ALTER TABLE USERS ADD COLUMN api_key TEXT;
