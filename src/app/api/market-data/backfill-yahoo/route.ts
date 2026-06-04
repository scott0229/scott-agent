import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

export const dynamic = 'force-dynamic';

/**
 * One-shot backfill of market_prices OHLC from Yahoo Finance.
 *
 * Existing /api/market-data/backfill uses Alpha Vantage which is capped at
 * 25 requests/day on the free tier — after the cron exhausts the quota,
 * any catch-up backfill 503s with a Note instead of data. Yahoo's chart
 * endpoint has no key, no day cap, and returns the same OHLC fields, so
 * it's the right tool when we need to repair historical rows once.
 *
 * Upsert behavior mirrors backfill/: writes close_price for legacy
 * compatibility AND open/high/low/close/volume so the daily-trades chart
 * card's QQQ open→close readout can light up on past dates.
 */
interface YahooChartResponse {
    chart?: {
        result?: {
            timestamp?: number[];
            indicators?: {
                quote?: {
                    open?: (number | null)[];
                    high?: (number | null)[];
                    low?: (number | null)[];
                    close?: (number | null)[];
                    volume?: (number | null)[];
                }[];
            };
        }[];
        error?: unknown;
    };
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const symbol: string = (body.symbol || 'QQQ').toUpperCase();
        // Yahoo accepts: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
        const range: string = body.range || '1y';

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d`;
        const yRes = await fetch(url, {
            headers: {
                // Yahoo can 401 bare bot UAs; mimic a normal browser fetch.
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
                'Accept': 'application/json',
            },
        });

        if (!yRes.ok) {
            const text = await yRes.text().catch(() => '');
            return NextResponse.json({
                success: false,
                error: `Yahoo returned ${yRes.status}: ${text.substring(0, 200)}`,
            }, { status: 502 });
        }

        const data = await yRes.json() as YahooChartResponse;
        const result = data.chart?.result?.[0];
        const timestamps = result?.timestamp;
        const quote = result?.indicators?.quote?.[0];

        if (!timestamps || !quote || timestamps.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'Yahoo response missing timestamp/quote arrays',
            }, { status: 502 });
        }

        // Upsert each day. Yahoo timestamps are at market-open epoch (e.g.
        // 13:30 UTC for US equities). Normalize to UTC midnight so the
        // (symbol, date) unique constraint matches existing rows that were
        // inserted at midnight by the Alpha Vantage path.
        const stmt = db.prepare(`
            INSERT INTO market_prices (symbol, date, close_price, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, date) DO UPDATE SET
                close_price=excluded.close_price,
                open=excluded.open,
                high=excluded.high,
                low=excluded.low,
                close=excluded.close,
                volume=excluded.volume
        `);

        const batch: ReturnType<typeof stmt.bind>[] = [];
        let skipped = 0;
        for (let i = 0; i < timestamps.length; i++) {
            const ts = timestamps[i];
            const close = quote.close?.[i];
            const open = quote.open?.[i];
            const high = quote.high?.[i];
            const low = quote.low?.[i];
            const volume = quote.volume?.[i];
            if (close == null || open == null) {
                skipped++;
                continue;
            }
            // Normalize to UTC midnight.
            const d = new Date(ts * 1000);
            const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
            batch.push(stmt.bind(symbol, midnight, close, open, high ?? null, low ?? null, close, volume ?? null));
        }

        let upserted = 0;
        if (batch.length > 0) {
            await db.batch(batch);
            upserted = batch.length;
        }

        return NextResponse.json({
            success: true,
            symbol,
            range,
            upserted,
            skipped,
            firstDate: timestamps.length > 0 ? new Date(timestamps[0] * 1000).toISOString().substring(0, 10) : null,
            lastDate: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1] * 1000).toISOString().substring(0, 10) : null,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed';
        console.error('Yahoo backfill failed:', error);
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
