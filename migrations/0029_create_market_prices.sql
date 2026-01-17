-- Create market_prices table for storing ETF data
CREATE TABLE market_prices (
    symbol TEXT NOT NULL,
    date INTEGER NOT NULL,
    close_price REAL NOT NULL,
    PRIMARY KEY (symbol, date)
);

CREATE INDEX idx_market_prices_date ON market_prices(date);
