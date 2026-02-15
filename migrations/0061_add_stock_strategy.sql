-- Add stock_strategy column to STRATEGIES table
-- Stores comma-separated values: '價差', '不持有', or both
ALTER TABLE STRATEGIES ADD COLUMN stock_strategy TEXT DEFAULT NULL;

-- Add stock_strategy_params column to STRATEGIES table
-- Stores JSON parameters, e.g. {"spread_target_pct": 5}
ALTER TABLE STRATEGIES ADD COLUMN stock_strategy_params TEXT DEFAULT NULL;
