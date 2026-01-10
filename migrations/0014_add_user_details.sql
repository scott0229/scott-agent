-- Add management_fee, ib_account, and phone to USERS table
ALTER TABLE USERS ADD COLUMN management_fee REAL DEFAULT 4.0;
ALTER TABLE USERS ADD COLUMN ib_account TEXT;
ALTER TABLE USERS ADD COLUMN phone TEXT;
