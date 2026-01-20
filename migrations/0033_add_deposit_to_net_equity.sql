-- Add deposit column to DAILY_NET_EQUITY table
ALTER TABLE DAILY_NET_EQUITY ADD COLUMN deposit REAL DEFAULT 0;

-- Update DAILY_NET_EQUITY with aggregated values using a direct correlated subquery
UPDATE DAILY_NET_EQUITY
SET deposit = COALESCE((
    SELECT SUM(CASE 
        WHEN transaction_type = 'withdrawal' THEN -amount 
        ELSE amount 
    END)
    FROM DEPOSITS
    WHERE DEPOSITS.user_id = DAILY_NET_EQUITY.user_id
    AND DEPOSITS.deposit_date = DAILY_NET_EQUITY.date
), 0);
