-- Create STOCK_TRADES table
CREATE TABLE IF NOT EXISTS STOCK_TRADES (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT, -- For API reference (optional if owner_id is enough, but kept for consistency)
    owner_id INTEGER, -- Link to USERS.id
    year INTEGER NOT NULL DEFAULT 2025,
    symbol TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Holding', -- Holding (持有中), Closed (已關倉)
    open_date INTEGER NOT NULL, -- Unix Timestamp
    close_date INTEGER, -- Unix Timestamp, nullable
    open_price REAL NOT NULL,
    close_price REAL,
    quantity REAL NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_trades_year ON STOCK_TRADES(year);
CREATE INDEX IF NOT EXISTS idx_stock_trades_owner_id ON STOCK_TRADES(owner_id);
CREATE INDEX IF NOT EXISTS idx_stock_trades_symbol ON STOCK_TRADES(symbol);
