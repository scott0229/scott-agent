-- Cache for the report's 近25交易日現金流 value.
--
-- Computing it runs generateDailyTradesText once per traded day in the
-- window (~25 renders + regex sums), which is CPU-heavy and was pushing
-- the report worker toward Cloudflare's per-request CPU ceiling (Error
-- 1102), especially when admin/users batch-generates every user's report.
--
-- Keyed by (user_id, end_date). For a past end_date the value is immutable
-- and cached forever; for today's end_date the caller re-validates against
-- computed_at (a short freshness window) since intraday trades can still
-- change it.
CREATE TABLE IF NOT EXISTS daily_premium_cache (
    user_id     INTEGER NOT NULL,
    end_date    TEXT    NOT NULL,   -- 'YYYY-MM-DD'
    value       REAL    NOT NULL,   -- summed option 收益 over the last 25 trading days
    computed_at INTEGER NOT NULL,   -- unix seconds
    PRIMARY KEY (user_id, end_date)
);
