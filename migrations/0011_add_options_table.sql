-- Create OPTIONS table
CREATE TABLE IF NOT EXISTS OPTIONS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'Open', -- 未平倉, 已關, etc.
    operation TEXT, -- 操作: 無, 滾動, etc.
    open_date INTEGER NOT NULL, -- 開倉日 (Unix Timestamp)
    to_date INTEGER, -- 到期日 (Unix Timestamp)
    settlement_date INTEGER, -- 結算日 (Unix Timestamp, nullable)
    days_to_expire INTEGER, -- 到期天數 (Computed or stored)
    days_held INTEGER, -- 持有天數 (Computed or stored)
    quantity REAL NOT NULL, -- 口數
    underlying TEXT NOT NULL, -- 底層標的 (QQQ, TQQQ, etc.)
    type TEXT NOT NULL, -- 多空 (CALL, PUT)
    strike_price REAL NOT NULL, -- 行權價
    collateral REAL, -- 備兌資金
    premium REAL, -- 權利金
    final_profit REAL, -- 最終損益
    profit_percent REAL, -- 損益%
    delta REAL, -- DELTA
    iv REAL, -- 隱含波動
    capital_efficiency REAL, -- 資金效率
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Index for efficient querying by date
CREATE INDEX IF NOT EXISTS idx_options_open_date ON OPTIONS(open_date);
