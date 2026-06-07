/**
 * One-shot intraday-minute backfill — sweeps every distinct
 * (date, HH:MM) tuple where a QQQ option trade was opened in the
 * last 60 days and resolves any missing spot into
 * market_prices_minute. 60 days is the upper bound of Yahoo's 5m
 * history window; older trades have no upstream source.
 *
 * Intended to be called once after deploying the minute cache —
 * the cron-side backfill keeps the rolling 7-day window fresh but
 * doesn't reach back further on its own. Safe to re-run: every
 * minute already in DB short-circuits before the Yahoo call.
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { getIntradayPricesForMinutes } from '@/lib/intraday-prices';

export const dynamic = 'force-dynamic';
// Long-running: 60 days × per-day SELECT + (occasionally) Yahoo fetch.
// Each Yahoo call is ~1-2s, DB roundtrips ~50ms, so worst-case end-to-end
// is well under a minute — but give the request room either way.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
    const payload = await verifyToken(req.cookies.get('token')?.value || '');
    if (!payload || payload.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);

    // 60 days back from today's ET calendar date. Yahoo's 5m history
    // window is ~60 days; we don't bother walking past that.
    const dates: string[] = [];
    const todayHkt = new Date(Date.now() + 8 * 3600 * 1000);
    for (let i = 0; i < 60; i++) {
        const d = new Date(todayHkt);
        d.setUTCDate(d.getUTCDate() - i);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${day}`);
    }

    let scannedDays = 0;
    let yahooHits = 0;
    let mintsCached = 0;
    const errors: string[] = [];

    for (const dateStr of dates) {
        try {
            const { results: tradeMinutes } = await db.prepare(`
                SELECT DISTINCT
                    strftime('%H:%M', datetime(open_date, 'unixepoch')) AS hhmm
                FROM OPTIONS
                WHERE underlying = 'QQQ'
                  AND open_date IS NOT NULL
                  AND date(datetime(open_date, 'unixepoch')) = ?
            `).bind(dateStr).all<{ hhmm: string }>();

            const required = new Set((tradeMinutes || []).map(r => r.hhmm));
            if (required.size === 0) continue;
            scannedDays++;

            // Pre-check DB to count whether this day actually needs Yahoo.
            const { results: cached } = await db.prepare(
                `SELECT hhmm FROM market_prices_minute WHERE symbol = 'QQQ' AND date_str = ?`,
            ).bind(dateStr).all<{ hhmm: string }>();
            const cachedSet = new Set((cached || []).map(r => r.hhmm));
            const missing = [...required].filter(h => !cachedSet.has(h));
            if (missing.length === 0) continue;

            const resolved = await getIntradayPricesForMinutes(db, 'QQQ', dateStr, required);
            yahooHits++;
            mintsCached += missing.filter(h => resolved[h] != null).length;
        } catch (e) {
            errors.push(`${dateStr}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return NextResponse.json({
        success: true,
        windowDays: dates.length,
        scannedDays,
        yahooHits,
        mintsCached,
        errors,
    });
}
