/**
 * One-shot sweep that re-anchors OPTIONS.underlying_price (當時股價)
 * to whatever market_prices_minute holds for the same symbol /
 * date / minute.
 *
 * Why needed:
 *   - The IB import path stamps underlying_price from whatever price
 *     the statement carried, which can drift from a true spot at
 *     the trade's exact minute (rounding, mid vs trade, etc.).
 *   - market_prices_minute is now the canonical minute-bar cache
 *     for the daily-trades card's "@spot" badge.
 *   - We want the options table's 當時股價 column to agree with the
 *     minute cache so the /options page and group dialog stop
 *     showing a different number from what the daily-trades card
 *     displayed for the same trade.
 *
 * Scope: 60 days back (Yahoo's 5m history horizon — older minutes
 * cannot be re-fetched anyway, so the cache won't have them either).
 *
 * Admin only. Re-runs are idempotent — rows whose underlying_price
 * already matches the cache are skipped, and matching uses a small
 * float epsilon so floating-point noise doesn't bloat the write set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PRICE_EPSILON = 0.01;

export async function POST(req: NextRequest) {
    const payload = await verifyToken(req.cookies.get('token')?.value || '');
    if (!payload || payload.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const days = Math.min(parseInt(url.searchParams.get('days') || '60', 10) || 60, 365);
    // Default to all underlyings the cache may hold; allow an explicit
    // ?symbol= filter for targeted sweeps (e.g. just QQQ).
    const symbolFilter = url.searchParams.get('symbol');

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);

    // Join OPTIONS to the minute cache on (symbol, date_str, hhmm).
    // strftime here mirrors how the formatter derives the minute key —
    // open_date is stored as "ET wall-clock interpreted as UTC", so
    // strftime('%H:%M', ...'unixepoch') yields the literal ET HH:MM the
    // intraday cache writes under.
    let whereExtra = '';
    const params: (string | number)[] = [];
    if (symbolFilter) {
        whereExtra = ' AND o.underlying = ?';
        params.push(symbolFilter);
    }
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    params.unshift(since);

    const sql = `
        SELECT o.id,
               o.underlying,
               o.underlying_price AS current_price,
               m.close AS minute_price,
               strftime('%H:%M', datetime(o.open_date, 'unixepoch')) AS hhmm,
               date(datetime(o.open_date, 'unixepoch')) AS date_str
        FROM OPTIONS o
        INNER JOIN market_prices_minute m
          ON m.symbol = o.underlying
         AND m.date_str = date(datetime(o.open_date, 'unixepoch'))
         AND m.hhmm = strftime('%H:%M', datetime(o.open_date, 'unixepoch'))
        WHERE o.open_date >= ?${whereExtra}
    `;
    const { results } = await db.prepare(sql).bind(...params).all<{
        id: number;
        underlying: string;
        current_price: number | null;
        minute_price: number;
        hhmm: string;
        date_str: string;
    }>();

    const rows = results || [];
    const updates = rows.filter(r => {
        if (r.minute_price == null) return false;
        if (r.current_price == null) return true;
        return Math.abs(r.current_price - r.minute_price) > PRICE_EPSILON;
    });

    if (updates.length === 0) {
        return NextResponse.json({
            success: true,
            scanned: rows.length,
            updated: 0,
            sample: [],
        });
    }

    const updateStmt = db.prepare(
        `UPDATE OPTIONS SET underlying_price = ?, updated_at = unixepoch() WHERE id = ?`,
    );
    await db.batch(updates.map(u => updateStmt.bind(u.minute_price, u.id)));

    // Return a small sample for the operator to spot-check the swap.
    const sample = updates.slice(0, 10).map(u => ({
        id: u.id,
        underlying: u.underlying,
        date: u.date_str,
        hhmm: u.hhmm,
        before: u.current_price,
        after: u.minute_price,
    }));

    return NextResponse.json({
        success: true,
        scanned: rows.length,
        updated: updates.length,
        sample,
    });
}
