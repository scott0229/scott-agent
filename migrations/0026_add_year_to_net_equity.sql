-- Add year column to DAILY_NET_EQUITY
ALTER TABLE DAILY_NET_EQUITY ADD COLUMN year INTEGER NOT NULL DEFAULT 2025;

-- Create index for year filtering
CREATE INDEX IF NOT EXISTS idx_daily_net_equity_year ON DAILY_NET_EQUITY(year);
CREATE INDEX IF NOT EXISTS idx_daily_net_equity_user_year ON DAILY_NET_EQUITY(user_id, year);
