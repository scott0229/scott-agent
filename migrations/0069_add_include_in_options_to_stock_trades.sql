-- Add include_in_options flag to STOCK_TRADES
-- When set to 1, the stock trade's P&L is included in the options revenue calculation
ALTER TABLE STOCK_TRADES ADD COLUMN include_in_options INTEGER DEFAULT 0;
