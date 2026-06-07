/**
 * Intraday minute-bar fetcher for the daily-trades view. We hit Yahoo
 * Finance's chart endpoint with interval=1m and return a map keyed by
 * "HH:MM in America/New_York" so the formatter can look up the QQQ
 * spot at each trade's time of day.
 *
 * Why ET keys: trade timestamps in this codebase are stored as
 * "ET wall-clock interpreted as UTC" (the IB import path drops TZ
 * info), so the formatter reads them via getUTCHours()/getUTCMinutes()
 * and ends up with the literal ET hour:minute string. Yahoo returns
 * real UTC unix timestamps — we re-project them into ET via
 * Intl.DateTimeFormat so the two sides match by string equality.
 *
 * Yahoo's 1-minute interval is bounded to ~the last 7 trading days;
 * older dates fall back to 5-minute (60d history). We swallow all
 * fetch errors silently — the underlying price column on the daily
 * card is a nice-to-have, not a correctness path.
 */

/** Minute-of-day key → spot close from the matching bar. */
export type IntradayMinuteMap = Record<string, number>;

const ET_HHMM = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

function unixToEtHHMM(unixSec: number): string {
    // Intl returns e.g. "09:39"; some locales render midnight as "24:00",
    // pin that back to "00:00".
    const raw = ET_HHMM.format(new Date(unixSec * 1000));
    return raw.replace('24:', '00:');
}

interface YahooQuote {
    open?: (number | null)[];
    high?: (number | null)[];
    low?: (number | null)[];
    close?: (number | null)[];
}

interface YahooResponse {
    chart?: {
        result?: {
            timestamp?: number[];
            indicators?: { quote?: YahooQuote[] };
        }[];
        error?: { code?: string; description?: string } | null;
    };
}

async function fetchYahooBars(
    symbol: string,
    dateStr: string,
    interval: '1m' | '5m',
): Promise<{ ts: number[]; close: (number | null)[] } | null> {
    // dateStr is YYYY-MM-DD. We want a window covering the full ET
    // trading day. ET 04:00–20:00 covers pre/post market on both DST
    // shifts; converting that to UTC and back is safer than computing
    // exact bounds. period1 = start-of-day UTC, period2 = +1 day.
    const dayStart = Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
    const dayEnd = dayStart + 86400;
    const url =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?period1=${dayStart}&period2=${dayEnd}&interval=${interval}`;
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as YahooResponse;
        const result = data.chart?.result?.[0];
        const ts = result?.timestamp;
        const close = result?.indicators?.quote?.[0]?.close;
        if (!ts || !close) return null;
        return { ts, close };
    } catch {
        return null;
    }
}

/**
 * Returns a HH:MM-in-ET → close-price map for `symbol` on `dateStr`.
 * Empty object if no data could be fetched (older than ~60 days, market
 * holiday, transient Yahoo error).
 */
export async function fetchIntradayMinuteMap(
    symbol: string,
    dateStr: string,
): Promise<IntradayMinuteMap> {
    // Try 1m first for the freshest precision; fall back to 5m if Yahoo
    // returned empty (likely outside the 1m history window).
    let bars = await fetchYahooBars(symbol, dateStr, '1m');
    if (!bars || bars.ts.length === 0) {
        bars = await fetchYahooBars(symbol, dateStr, '5m');
    }
    if (!bars) return {};
    const map: IntradayMinuteMap = {};
    for (let i = 0; i < bars.ts.length; i++) {
        const price = bars.close[i];
        if (price == null) continue;
        map[unixToEtHHMM(bars.ts[i])] = price;
    }
    return map;
}
