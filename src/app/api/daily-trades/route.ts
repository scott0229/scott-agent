import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { getIntradayPricesForMinutes } from '@/lib/intraday-prices';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const payload = await verifyToken(req.cookies.get('token')?.value || '');
        if (!payload || !['admin', 'manager', 'customer'].includes(payload.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const dateStr = searchParams.get('date'); // e.g., '2026-05-06'
        const yearStr = searchParams.get('year');

        if (!dateStr) {
            return NextResponse.json({ error: 'Missing date parameter' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Fetch all non-admin users
        let usersQuery = `SELECT id, user_id, name, avatar_url, ib_account FROM USERS WHERE email != 'admin'`;
        const usersParams: any[] = [];
        
        if (yearStr && yearStr !== 'All') {
            usersQuery += ` AND year = ?`;
            usersParams.push(parseInt(yearStr));
        }
        
        // If customer, only see own data
        if (payload.role === 'customer') {
            usersQuery += ` AND id = ?`;
            usersParams.push(payload.userId);
        }

        const { results: users } = await db.prepare(usersQuery).bind(...usersParams).all();
        if (!users || users.length === 0) {
            return NextResponse.json({ data: [] });
        }

        const userIds = users.map((u: any) => u.id);

        // Queries for Options and Stocks that happened exactly on this date string
        // We use date(datetime(column, 'unixepoch')) to match 'YYYY-MM-DD'
        
        // 1. Stock Opens (Buys)
        const { results: stockOpens } = await db.prepare(`
            SELECT id, owner_id, symbol, quantity, open_price as price, 'stock' as asset_type, 'open' as action_type, source
            FROM STOCK_TRADES
            WHERE date(datetime(open_date, 'unixepoch')) = ? AND owner_id IN (${userIds.join(',')})
        `).bind(dateStr).all();

        // 2. Stock Closes (Sells)
        const { results: stockCloses } = await db.prepare(`
            SELECT id, owner_id, symbol, quantity, close_price as price, open_price, 'stock' as asset_type, 'close' as action_type, close_source
            FROM STOCK_TRADES
            WHERE close_date IS NOT NULL AND date(datetime(close_date, 'unixepoch')) = ? AND owner_id IN (${userIds.join(',')})
        `).bind(dateStr).all();

        // 3. Option Opens
        const { results: optionOpens } = await db.prepare(`
            SELECT id, owner_id, underlying as symbol, type as option_type, strike_price, quantity, premium as price, group_id, 'option' as asset_type, 'open' as action_type, to_date, open_date
            FROM OPTIONS
            WHERE date(datetime(open_date, 'unixepoch')) = ? AND owner_id IN (${userIds.join(',')})
        `).bind(dateStr).all();

        // 4. Option Closes/Settlements
        //    open_date is still included so the formatter can pair each close
        //    with its corresponding open in a roll and borrow the open's time
        //    of day (settlement_date is rounded to midnight, no HH:MM there).
        const { results: optionCloses } = await db.prepare(`
            SELECT id, owner_id, underlying as symbol, type as option_type, strike_price, quantity, final_profit as profit, premium as old_premium, group_id, 'option' as asset_type, 'close' as action_type, to_date, operation, open_date
            FROM OPTIONS
            WHERE settlement_date IS NOT NULL AND date(datetime(settlement_date, 'unixepoch')) = ? AND owner_id IN (${userIds.join(',')})
        `).bind(dateStr).all();

        // Group by user
        const groupedData = users.map((u: any) => {
            const userTrades = [
                ...(stockOpens || []).filter((t: any) => t.owner_id === u.id),
                ...(stockCloses || []).filter((t: any) => t.owner_id === u.id),
                ...(optionOpens || []).filter((t: any) => t.owner_id === u.id),
                ...(optionCloses || []).filter((t: any) => t.owner_id === u.id),
            ];

            return {
                user: u,
                trades: userTrades
            };
        }).filter((u: any) => u.trades.length > 0);

        const { results: marketPrices } = await db.prepare(`
            SELECT symbol, close_price FROM market_prices
            WHERE date(datetime(date, 'unixepoch')) <= ?
            AND date = (
                SELECT MAX(date) FROM market_prices AS mp2
                WHERE mp2.symbol = market_prices.symbol
                AND date(datetime(mp2.date, 'unixepoch')) <= ?
            )
        `).bind(dateStr, dateStr).all();

        const marketDataMap: Record<string, number> = {};
        marketPrices?.forEach((mp: any) => {
            marketDataMap[mp.symbol] = mp.close_price;
        });

        // QQQ open/close for the selected date — surfaced in the chart card
        // header and per-user cards so users see the underlying's daily range
        // alongside their P&L without leaving the page.
        //
        // OHLC backfill runs after close, so for the current trading day the
        // open/close columns are still null even though close_price is being
        // updated intraday. Fallback path: use the PREVIOUS trading day's
        // close as the "open" anchor and today's close_price (live spot) as
        // the "close". That keeps the QQQ readout meaningful intraday — it
        // becomes "previous close → spot" instead of vanishing entirely.
        const dayMarket = await db.prepare(`
            SELECT symbol, open, close, close_price FROM market_prices
            WHERE symbol = 'QQQ' AND date(datetime(date, 'unixepoch')) = ?
        `).bind(dateStr).first<{ symbol: string; open: number | null; close: number | null; close_price: number | null }>();
        const dayMarketStats: Record<string, { open: number | null; close: number | null }> = {};
        if (dayMarket) {
            let open = dayMarket.open;
            let close = dayMarket.close;
            if ((open == null || close == null) && dayMarket.close_price != null) {
                const prev = await db.prepare(`
                    SELECT close FROM market_prices
                    WHERE symbol = 'QQQ' AND date(datetime(date, 'unixepoch')) < ?
                          AND close IS NOT NULL
                    ORDER BY date DESC LIMIT 1
                `).bind(dateStr).first<{ close: number | null }>();
                if (prev?.close != null) {
                    open = prev.close;
                    close = dayMarket.close_price;
                }
            }
            dayMarketStats[dayMarket.symbol] = { open, close };
        }

        // Per-symbol minute-bar map keyed by ET HH:MM. The formatter
        // looks up intradayPrices[trade.symbol][hhmm] to surface the
        // underlying's spot price next to each trade's time.
        //
        // We only resolve the minutes that actually have option trades
        // — open_date carries "ET wall-clock as UTC" so getUTCHours/
        // Minutes gives the literal ET HH:MM key. Closes borrow the
        // paired open's time client-side, so an open-minute set is a
        // sufficient cover. The helper checks DB cache first and only
        // hits Yahoo for the missing minutes; resolved bars are
        // persisted via INSERT ... ON CONFLICT so the next view of the
        // same date answers from DB alone.
        //
        // Bucket required minutes by symbol so multi-underlying days
        // (QQQ + TQQQ + QLD …) get all their spots resolved in one
        // pass — one Yahoo round-trip per symbol when it's a miss.
        const intradayPrices: Record<string, Record<string, number>> = {};
        const requiredBySymbol = new Map<string, Set<string>>();
        for (const o of (optionOpens || []) as any[]) {
            if (!o.symbol || o.open_date == null) continue;
            const d = new Date(o.open_date * 1000);
            const hh = String(d.getUTCHours()).padStart(2, '0');
            const mm = String(d.getUTCMinutes()).padStart(2, '0');
            if (!requiredBySymbol.has(o.symbol)) requiredBySymbol.set(o.symbol, new Set());
            requiredBySymbol.get(o.symbol)!.add(`${hh}:${mm}`);
        }
        for (const [symbol, minutes] of requiredBySymbol.entries()) {
            if (minutes.size === 0) continue;
            try {
                const map = await getIntradayPricesForMinutes(db, symbol, dateStr, minutes);
                if (Object.keys(map).length > 0) {
                    intradayPrices[symbol] = map;
                }
            } catch (e) {
                console.warn(`intraday fetch failed for ${symbol} (non-fatal):`, e);
            }
        }

        // Naked-CALL coverage check for EVERY shown user at end of the
        // viewed date, so the warning renders in 全部帳戶 mode too (the
        // holdings endpoint only serves single-account mode). Point-in-
        // time rules match /api/daily-trades/holdings:
        //   held on D ⇔ open<=D && (settle null || settle>D) && expiry>=D
        // naked ⇔ shortCalls×100 > shares + longCalls×100, per underlying.
        const nakedCalls: Record<number, { u: string; short: number; long: number; shares: number; gap: number }[]> = {};
        try {
            const { results: callAgg } = await db.prepare(`
                SELECT owner_id, underlying,
                       SUM(CASE WHEN quantity < 0 THEN -quantity ELSE 0 END) as short_calls,
                       SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END) as long_calls
                FROM OPTIONS
                WHERE owner_id IN (${userIds.join(',')})
                  AND type = 'CALL'
                  AND date(datetime(open_date, 'unixepoch')) <= ?
                  AND (settlement_date IS NULL OR date(datetime(settlement_date, 'unixepoch')) > ?)
                  AND (to_date IS NULL OR date(datetime(to_date, 'unixepoch')) >= ?)
                GROUP BY owner_id, underlying
                HAVING SUM(CASE WHEN quantity < 0 THEN -quantity ELSE 0 END) > 0
            `).bind(dateStr, dateStr, dateStr).all<{
                owner_id: number; underlying: string; short_calls: number; long_calls: number;
            }>();

            if ((callAgg || []).length > 0) {
                const { results: shareAgg } = await db.prepare(`
                    SELECT owner_id, symbol, SUM(quantity) as shares
                    FROM STOCK_TRADES
                    WHERE owner_id IN (${userIds.join(',')})
                      AND date(datetime(open_date, 'unixepoch')) <= ?
                      AND (close_date IS NULL OR date(datetime(close_date, 'unixepoch')) > ?)
                    GROUP BY owner_id, symbol
                `).bind(dateStr, dateStr).all<{ owner_id: number; symbol: string; shares: number }>();

                const sharesByKey = new Map<string, number>();
                for (const r of shareAgg || []) {
                    sharesByKey.set(`${r.owner_id}|${r.symbol}`, r.shares);
                }

                for (const c of callAgg || []) {
                    const shares = sharesByKey.get(`${c.owner_id}|${c.underlying}`) || 0;
                    const gap = c.short_calls * 100 - (shares + c.long_calls * 100);
                    if (gap <= 0) continue;
                    if (!nakedCalls[c.owner_id]) nakedCalls[c.owner_id] = [];
                    nakedCalls[c.owner_id].push({
                        u: c.underlying,
                        short: c.short_calls,
                        long: c.long_calls,
                        shares,
                        gap,
                    });
                }
            }
        } catch (e) {
            console.warn('naked-call check failed (non-fatal):', e);
        }

        return NextResponse.json({ data: groupedData, marketData: marketDataMap, dayMarketStats, intradayPrices, nakedCalls });
    } catch (error: any) {
        console.error('Failed to fetch daily trades:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
