-- Add exposure_adjustment column to DAILY_NET_EQUITY
-- Values: 'none' (default), 'buy_qqq', 'buy_qld'
ALTER TABLE DAILY_NET_EQUITY ADD COLUMN exposure_adjustment TEXT DEFAULT 'none';
