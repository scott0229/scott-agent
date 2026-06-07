import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { fetchIntradayMinuteMap } from '@/lib/intraday-prices';

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

        // QQQ minute-bar map keyed by ET HH:MM. Used by the formatter to
        // surface the underlying's spot price next to each trade's time.
        // Fetched per request (Yahoo's chart endpoint, no key, cheap),
        // returns empty when data isn't available — the formatter just
        // omits the price column in that case.
        const intradayPrices: Record<string, Record<string, number>> = {};
        try {
            const qqqMinutes = await fetchIntradayMinuteMap('QQQ', dateStr);
            if (Object.keys(qqqMinutes).length > 0) {
                intradayPrices['QQQ'] = qqqMinutes;
            }
        } catch (e) {
            console.warn('intraday fetch failed (non-fatal):', e);
        }

        return NextResponse.json({ data: groupedData, marketData: marketDataMap, dayMarketStats, intradayPrices });
    } catch (error: any) {
        console.error('Failed to fetch daily trades:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
