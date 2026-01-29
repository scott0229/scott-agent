-- Create STRATEGIES table
CREATE TABLE IF NOT EXISTS STRATEGIES (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id TEXT, -- For API reference (user_id string)
    owner_id INTEGER, -- Link to USERS.id
    year INTEGER NOT NULL DEFAULT 2025,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Create junction table for strategies and stock trades
CREATE TABLE IF NOT EXISTS STRATEGY_STOCKS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    stock_trade_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (strategy_id) REFERENCES STRATEGIES(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_trade_id) REFERENCES STOCK_TRADES(id) ON DELETE CASCADE,
    UNIQUE(strategy_id, stock_trade_id)
);

-- Create junction table for strategies and options
CREATE TABLE IF NOT EXISTS STRATEGY_OPTIONS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    option_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (strategy_id) REFERENCES STRATEGIES(id) ON DELETE CASCADE,
    FOREIGN KEY (option_id) REFERENCES OPTIONS(id) ON DELETE CASCADE,
    UNIQUE(strategy_id, option_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategies_owner_id ON STRATEGIES(owner_id);
CREATE INDEX IF NOT EXISTS idx_strategies_year ON STRATEGIES(year);
CREATE INDEX IF NOT EXISTS idx_strategy_stocks_strategy_id ON STRATEGY_STOCKS(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_stocks_stock_trade_id ON STRATEGY_STOCKS(stock_trade_id);
CREATE INDEX IF NOT EXISTS idx_strategy_options_strategy_id ON STRATEGY_OPTIONS(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_options_option_id ON STRATEGY_OPTIONS(option_id);
