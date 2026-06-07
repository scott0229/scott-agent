/**
 * Intraday minute-bar lookup for the daily-trades view. Returns a
 * "HH:MM in ET" → spot close map for the minutes the formatter
 * actually needs (those where the user executed an option trade).
 *
 * Layered storage:
 *   1. DB cache `market_prices_minute` keyed by (symbol, date_str, hhmm).
 *      Persistent — once a minute is recorded it survives Yahoo's
 *      1m/5m history windows expiring.
 *   2. Yahoo Finance chart endpoint (1m → 5m fallback). Hit only for
 *      the minutes still missing after the DB lookup, and we only
 *      write back the minutes the caller asked for so the table stays
 *      lean ("一分鐘 一交易 一列").
 *
 * Why ET keys: trade timestamps are stored as "ET wall-clock
 * interpreted as UTC" by the IB import path, so the formatter reads
 * them via getUTCHours()/getUTCMinutes() and ends up with the literal
 * ET hour:minute string. Yahoo timestamps are real UTC — we
 * re-project them into ET via Intl.DateTimeFormat so both sides
 * (writes and reads) share the same key space.
 */

import type { D1Database } from '@cloudflare/workers-types';

/** Minute-of-day key → spot close from the matching bar. */
export type IntradayMinuteMap = Record<string, number>;

const ET_HHMM = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

function unixToEtHHMM(unixSec: number): string {
    // Intl renders midnight in some locales as "24:00" — pin back to "00:00"
    // so the key space stays canonical.
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
    // dateStr is YYYY-MM-DD. Yahoo wants epoch bounds; we hand it the
    // whole day in UTC and let interval do the granularity work. The
    // ±1 day padding covers the ET offset so DST shifts don't clip
    // edge minutes.
    const dayStart = Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000) - 86400;
    const dayEnd = dayStart + 86400 * 3;
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

async function fetchYahooMinuteMapForDate(
    symbol: string,
    dateStr: string,
): Promise<IntradayMinuteMap> {
    // 1m gives the most precise lookup but Yahoo only retains it for
    // ~7 calendar days. 5m extends to ~60 days at acceptable resolution.
    let bars = await fetchYahooBars(symbol, dateStr, '1m');
    let barSpanMinutes = 1;
    if (!bars || bars.ts.length === 0) {
        bars = await fetchYahooBars(symbol, dateStr, '5m');
        barSpanMinutes = 5;
    }
    if (!bars) return {};
    const map: IntradayMinuteMap = {};
    for (let i = 0; i < bars.ts.length; i++) {
        const close = bars.close[i];
        if (close == null) continue;
        // Filter to the requested calendar date in ET before keying — the
        // ±1 day padding above grabs prior/next-day pre-market bars we
        // don't want polluting the map.
        const dayIso = new Date(bars.ts[i] * 1000).toLocaleDateString('en-CA', {
            timeZone: 'America/New_York',
        });
        if (dayIso !== dateStr) continue;
        // Spread each bar's close across every minute inside its span so
        // a trade at any minute within a 5m bar still finds a match.
        // The DB write path is surgical (only requested HH:MM are
        // persisted), so this replication just fattens the in-memory map.
        for (let m = 0; m < barSpanMinutes; m++) {
            map[unixToEtHHMM(bars.ts[i] + m * 60)] = close;
        }
    }
    return map;
}

/**
 * DB-first lookup with Yahoo fallback + write-through. Returns the
 * subset of minutes from `requiredHhmms` we managed to resolve.
 *
 * @param db             D1 binding
 * @param symbol         Ticker (currently always 'QQQ', but kept open)
 * @param dateStr        ET calendar date, 'YYYY-MM-DD'
 * @param requiredHhmms  Set of 'HH:MM' strings the formatter wants
 *                       prices for. We only write back the ones the
 *                       caller cares about so the table stays small.
 */
export async function getIntradayPricesForMinutes(
    db: D1Database,
    symbol: string,
    dateStr: string,
    requiredHhmms: Set<string>,
): Promise<IntradayMinuteMap> {
    if (requiredHhmms.size === 0) return {};

    // 1. DB lookup. Pull every cached minute for the day in one
    //    round-trip — the table is leaf-narrow, so a scan-by-prefix
    //    is cheap and avoids per-minute SELECTs.
    const out: IntradayMinuteMap = {};
    try {
        const { results } = await db.prepare(
            `SELECT hhmm, close FROM market_prices_minute WHERE symbol = ? AND date_str = ?`,
        ).bind(symbol, dateStr).all<{ hhmm: string; close: number }>();
        for (const r of results || []) {
            if (requiredHhmms.has(r.hhmm)) {
                out[r.hhmm] = r.close;
            }
        }
    } catch (e) {
        console.warn('intraday DB read failed (continuing to Yahoo):', e);
    }

    // 2. Anything still missing → Yahoo. One fetch covers the whole
    //    day; we just pick out the required minutes from the response.
    const missing = new Set<string>();
    for (const hhmm of requiredHhmms) {
        if (out[hhmm] == null) missing.add(hhmm);
    }
    if (missing.size === 0) return out;

    const yahooMap = await fetchYahooMinuteMapForDate(symbol, dateStr);
    if (Object.keys(yahooMap).length === 0) return out;

    // 3. Write through ONLY the required-and-resolved minutes. Skips
    //    pre-market / after-hours bars when no trade falls on them and
    //    keeps row growth proportional to actual activity.
    const writes: { hhmm: string; close: number }[] = [];
    for (const hhmm of missing) {
        const close = yahooMap[hhmm];
        if (close == null) continue;
        out[hhmm] = close;
        writes.push({ hhmm, close });
    }

    if (writes.length > 0) {
        try {
            const stmt = db.prepare(
                `INSERT INTO market_prices_minute (symbol, date_str, hhmm, close) VALUES (?, ?, ?, ?)
                 ON CONFLICT(symbol, date_str, hhmm) DO UPDATE SET close = excluded.close`,
            );
            await db.batch(writes.map(w => stmt.bind(symbol, dateStr, w.hhmm, w.close)));
        } catch (e) {
            console.warn('intraday DB write failed (read path still served):', e);
        }
    }

    return out;
}
