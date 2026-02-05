-- Add OHLCV columns to market_prices table
ALTER TABLE market_prices ADD COLUMN open REAL;
ALTER TABLE market_prices ADD COLUMN high REAL;
ALTER TABLE market_prices ADD COLUMN low REAL;
ALTER TABLE market_prices ADD COLUMN close REAL;
ALTER TABLE market_prices ADD COLUMN volume INTEGER;
