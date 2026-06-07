import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { generateDailyTradesText, DailyTradeRow, UserDailyTradesGroup } from '@/lib/daily-trades-text';

export const dynamic = 'force-dynamic';

/**
 * Daily option-收益 history for a single user, for the single-account
 * chart on /daily-trades. For each date in the window we run the same
 * text generator + regex-sum the daily-trades card uses, so chart
 * points agree with the card header total exactly.
 *
 * 30 trading days ≈ 45 calendar days; query 1.6× headroom so a string
 * of holidays can't push us short.
 */
export async function GET(req: NextRequest) {
    try {
        const payload = await verifyToken(req.cookies.get('token')?.value || '');
        if (!payload || !['admin', 'manager', 'customer'].includes(payload.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const userIdStr = searchParams.get('user_id');
        const endDateStr = searchParams.get('endDate');
        const daysStr = searchParams.get('days');
        const yearStr = searchParams.get('year');

        if (!userIdStr || !endDateStr) {
            return NextResponse.json({ error: 'Missing user_id or endDate' }, { status: 400 });
        }

        const days = Math.min(parseInt(daysStr || '30', 10) || 30, 90);
        const calendarDays = Math.ceil(days * 1.6);

        const endDate = new Date(endDateStr + 'T00:00:00Z');
        const startDate = new Date(endDate);
        startDate.setUTCDate(startDate.getUTCDate() - calendarDays);
        const startDateStr = startDate.toISOString().substring(0, 10);

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Resolve user_id (string alias) → numeric id
        let userQuery = `SELECT id, user_id, name, ib_account FROM USERS WHERE user_id = ? AND email != 'admin'`;
        const userParams: (string | number)[] = [userIdStr];
        if (yearStr && yearStr !== 'All') {
            userQuery += ` AND year = ?`;
            userParams.push(parseInt(yearStr, 10));
        }
        if (payload.role === 'customer') {
            userQuery += ` AND id = ?`;
            userParams.push(payload.userId);
        }
        const user = await db.prepare(userQuery).bind(...userParams).first<{
            id: number; user_id: string; name: string | null; ib_account: string | null;
        }>();
        if (!user) {
            return NextResponse.json({ history: [] });
        }

        // Pull all trades in the calendar window for this single user.
        // Same column aliases as /api/daily-trades so generateDailyTradesText
        // can consume the rows directly.
        const [stockOpens, stockCloses, optionOpens, optionCloses] = await Promise.all([
            db.prepare(`
                SELECT id, symbol, quantity, open_price as price, 'stock' as asset_type, 'open' as action_type, source,
                       date(datetime(open_date, 'unixepoch')) as trade_date
                FROM STOCK_TRADES
                WHERE date(datetime(open_date, 'unixepoch')) >= ? AND date(datetime(open_date, 'unixepoch')) <= ? AND owner_id = ?
            `).bind(startDateStr, endDateStr, user.id).all(),
            db.prepare(`
                SELECT id, symbol, quantity, close_price as price, open_price, 'stock' as asset_type, 'close' as action_type, close_source,
                       date(datetime(close_date, 'unixepoch')) as trade_date
                FROM STOCK_TRADES
                WHERE close_date IS NOT NULL AND date(datetime(close_date, 'unixepoch')) >= ? AND date(datetime(close_date, 'unixepoch')) <= ? AND owner_id = ?
            `).bind(startDateStr, endDateStr, user.id).all(),
            db.prepare(`
                SELECT id, underlying as symbol, type as option_type, strike_price, quantity, premium as price, group_id, 'option' as asset_type, 'open' as action_type, to_date, open_date,
                       date(datetime(open_date, 'unixepoch')) as trade_date
                FROM OPTIONS
                WHERE date(datetime(open_date, 'unixepoch')) >= ? AND date(datetime(open_date, 'unixepoch')) <= ? AND owner_id = ?
            `).bind(startDateStr, endDateStr, user.id).all(),
            db.prepare(`
                SELECT id, underlying as symbol, type as option_type, strike_price, quantity, final_profit as profit, premium as old_premium, group_id, 'option' as asset_type, 'close' as action_type, to_date, operation, open_date,
                       date(datetime(settlement_date, 'unixepoch')) as trade_date
                FROM OPTIONS
                WHERE settlement_date IS NOT NULL AND date(datetime(settlement_date, 'unixepoch')) >= ? AND date(datetime(settlement_date, 'unixepoch')) <= ? AND owner_id = ?
            `).bind(startDateStr, endDateStr, user.id).all(),
        ]);

        // Latest-known market price per symbol as of endDate — same shape as /api/daily-trades.
        const { results: marketPrices } = await db.prepare(`
            SELECT symbol, close_price FROM market_prices
            WHERE date(datetime(date, 'unixepoch')) <= ?
            AND date = (
                SELECT MAX(date) FROM market_prices AS mp2
                WHERE mp2.symbol = market_prices.symbol
                AND date(datetime(mp2.date, 'unixepoch')) <= ?
            )
        `).bind(endDateStr, endDateStr).all<{ symbol: string; close_price: number }>();
        const marketDataMap: Record<string, number> = {};
        (marketPrices || []).forEach(mp => { marketDataMap[mp.symbol] = mp.close_price; });

        // QQQ open/close per date across the window — the chart card's QQQ
        // readout hovers on the chart and needs each day's range available
        // without an extra round-trip. Map by YYYY-MM-DD so the merge below
        // can attach OHLC onto each history point.
        //
        // Fallback for intraday rows (typically only today): OHLC backfill
        // runs after close, so open/close are still null but close_price
        // tracks the live spot. Substitute the most recent prior close as
        // the "open" anchor + today's close_price as the "close" so the
        // current day still surfaces a meaningful daily move on the chart.
        const { results: qqqRows } = await db.prepare(`
            SELECT date(datetime(date, 'unixepoch')) as d, open, close, close_price
            FROM market_prices
            WHERE symbol = 'QQQ' AND date(datetime(date, 'unixepoch')) >= ? AND date(datetime(date, 'unixepoch')) <= ?
            ORDER BY date ASC
        `).bind(startDateStr, endDateStr).all<{ d: string; open: number | null; close: number | null; close_price: number | null }>();
        const qqqByDate: Record<string, { open: number | null; close: number | null }> = {};
        let prevClose: number | null = null;
        for (const r of qqqRows || []) {
            let open = r.open;
            let close = r.close;
            if ((open == null || close == null) && r.close_price != null && prevClose != null) {
                open = prevClose;
                close = r.close_price;
            }
            qqqByDate[r.d] = { open, close };
            if (r.close != null) prevClose = r.close;
        }

        // Bucket every trade row by its own trade_date string.
        const tradesByDate: Record<string, DailyTradeRow[]> = {};
        const allRows = [
            ...(stockOpens.results || []),
            ...(stockCloses.results || []),
            ...(optionOpens.results || []),
            ...(optionCloses.results || []),
        ] as (DailyTradeRow & { trade_date?: string | null })[];
        for (const row of allRows) {
            const d = row.trade_date;
            if (!d) continue;
            if (!tradesByDate[d]) tradesByDate[d] = [];
            tradesByDate[d].push(row);
        }

        // Walk every date that has trades, render text, regex-sum the same
        // way the card header does (skip stock 收益 / 損益 lines so options
        // are the only contributors).
        const userMeta: UserDailyTradesGroup['user'] = {
            id: user.id,
            user_id: user.user_id,
            name: user.name,
        };

        const PROFIT_RE = /(?:收益|權利金)\s*([+-]?[\d,]+(?:\.\d+)?)/g;
        const history = Object.keys(tradesByDate)
            .sort()
            .map(d => {
                const text = generateDailyTradesText(
                    { user: userMeta, trades: tradesByDate[d] },
                    d,
                    marketDataMap,
                );
                let profit = 0;
                for (const line of text.split('\n')) {
                    if (/^(買|賣)/.test(line) && line.includes(' 股 ')) continue;
                    for (const m of line.matchAll(PROFIT_RE)) {
                        profit += parseFloat(m[1].replace(/,/g, ''));
                    }
                }
                const qqq = qqqByDate[d];
                return {
                    date: d,
                    profit,
                    qqqOpen: qqq?.open ?? null,
                    qqqClose: qqq?.close ?? null,
                };
            });

        // Most-recent `days` entries only; older history is noise on a 30-day chart.
        const trimmed = history.slice(-days);

        return NextResponse.json({ history: trimmed });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed';
        console.error('Failed to fetch daily-trades history:', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
