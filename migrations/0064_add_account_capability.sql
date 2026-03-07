-- Add account_capability column to USERS table
-- Stores the account capability from IB reports (e.g., '投資組合保證金', 'Reg T 保證金')
ALTER TABLE USERS ADD COLUMN account_capability TEXT DEFAULT NULL;
