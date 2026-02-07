-- Rename 'Holding' (or '持有中') to 'Open' in stock_trades and options tables

-- Update stock_trades table
UPDATE STOCK_TRADES SET status = 'Open' WHERE status = 'Holding';

-- Update options table
UPDATE OPTIONS SET operation = 'Open' WHERE operation = '持有中';
