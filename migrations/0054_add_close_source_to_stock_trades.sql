-- Add close_source column to track how a stock trade was closed (e.g., 'assigned' for option assignment)
ALTER TABLE STOCK_TRADES ADD COLUMN close_source TEXT;
