-- Create TRADER_SETTINGS table for Electron app settings sync
CREATE TABLE IF NOT EXISTS TRADER_SETTINGS (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed default values
INSERT OR IGNORE INTO TRADER_SETTINGS (key, value) VALUES ('margin_limit', '1.3');
INSERT OR IGNORE INTO TRADER_SETTINGS (key, value) VALUES ('watch_symbols', '[]');
INSERT OR IGNORE INTO TRADER_SETTINGS (key, value) VALUES ('account_aliases', '{}');
