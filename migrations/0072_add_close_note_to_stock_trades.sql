-- Add close_note column to track notes on closed stock transactions
ALTER TABLE STOCK_TRADES ADD COLUMN close_note TEXT;
