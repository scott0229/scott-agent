-- 1. Create New User (idempotent check)
INSERT INTO USERS (user_id, email, password, role, year, created_at, updated_at, initial_cost, management_fee, ib_account, name, phone, avatar_url)
SELECT user_id, email, password, role, 2026, unixepoch(), unixepoch(), 0, management_fee, ib_account, name, phone, avatar_url
FROM USERS WHERE user_id = 'derren' AND year = 2025
AND NOT EXISTS (SELECT 1 FROM USERS WHERE user_id = 'derren' AND year = 2026);

-- 2. Move Data
-- Migrate Options
UPDATE OPTIONS 
SET owner_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2026)
WHERE year = 2026 AND owner_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2025);

-- Migrate Deposits
UPDATE DEPOSITS
SET user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2026)
WHERE year = 2026 AND user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2025);

-- Migrate Daily Net Equity
UPDATE DAILY_NET_EQUITY
SET user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2026)
WHERE year = 2026 AND user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2025);

-- Migrate Monthly Interest
UPDATE monthly_interest
SET user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2026)
WHERE year = 2026 AND user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2025);

-- Migrate Monthly Fees
UPDATE monthly_fees
SET user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2026)
WHERE year = 2026 AND user_id = (SELECT id FROM USERS WHERE user_id = 'derren' AND year = 2025);
