-- Add code field to STOCK_TRADES table
-- This field will store a 6-character unique identifier for each stock trade

-- Step 1: Add the code column
ALTER TABLE STOCK_TRADES ADD COLUMN code TEXT;

-- Step 2: Create unique index (this will fail if there are duplicates, but that's fine for new column)
-- Note: We'll generate codes in the UPDATE step, so no duplicates yet
CREATE UNIQUE INDEX idx_stock_trades_code ON STOCK_TRADES(code);
