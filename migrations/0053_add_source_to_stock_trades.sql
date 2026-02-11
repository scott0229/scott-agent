-- Add source column to track how a stock trade was created (e.g., 'assigned' for option assignment)
ALTER TABLE STOCK_TRADES ADD COLUMN source TEXT;
