-- Migration: Cache underlying intraday spot prices ONLY for the
-- minutes where the user actually executed trades.
--
-- We key by (symbol, date_str, hhmm) using ET wall-clock strings
-- because:
--   1. The trade open_date column in this codebase is stored as
--      "ET wall-clock interpreted as UTC" (the IB import drops the
--      timezone), so getUTCHours/Minutes on it already yields the
--      ET hour:minute we want. Storing by HH:MM avoids round-trip
--      timezone math at read time.
--   2. The Yahoo Finance fetcher (src/lib/intraday-prices.ts)
--      projects its real-UTC bar timestamps into ET via
--      Intl.DateTimeFormat, so writes also land on the ET key
--      without any conversion at the storage boundary.
--
-- Row growth is bounded — a normal day's worst case is one row per
-- minute of trade activity per user, so even active traders generate
-- only dozens of rows per day. Older rows stay useful as the chart
-- card's time-of-day spot display.
CREATE TABLE IF NOT EXISTS market_prices_minute (
    symbol TEXT NOT NULL,
    date_str TEXT NOT NULL, -- 'YYYY-MM-DD' (ET calendar date)
    hhmm TEXT NOT NULL,     -- 'HH:MM' (ET wall-clock)
    close REAL NOT NULL,    -- spot close at that minute bar
    PRIMARY KEY (symbol, date_str, hhmm)
);

-- Lookup pattern is always "for symbol S on date D, give me all
-- minutes we have" — covered by the PK's leading (symbol, date_str)
-- prefix, no extra index needed.
