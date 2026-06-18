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

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Window = the last `days` ACTUAL trading days (QQQ market_prices is
        // the authoritative open-day calendar) ending on endDate. Both the
        // profit and cash series are bounded to this same window so the two
        // charts always span identical dates. The profit series still only
        // plots days that had trades — but never reaches outside this window.
        const { results: tdRows } = await db.prepare(`
            SELECT date(datetime(date, 'unixepoch')) AS d
            FROM market_prices
            WHERE symbol = 'QQQ' AND date(datetime(date, 'unixepoch')) <= ?
            ORDER BY date DESC
            LIMIT ?
        `).bind(endDateStr, days).all<{ d: string }>();
        const tradingDays = (tdRows || []).map(r => r.d).filter(Boolean).reverse();
        // Oldest trading day in the window; fall back to a calendar estimate
        // if market_prices is somehow empty.
        const startDateStr = tradingDays.length > 0
            ? tradingDays[0]
            : new Date(new Date(endDateStr + 'T00:00:00Z').getTime() - days * 1.6 * 86400000).toISOString().substring(0, 10);

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
        // Per-day option profit for the days that actually had trades.
        const profitByDate: Record<string, number> = {};
        for (const d of Object.keys(tradesByDate)) {
            const text = generateDailyTradesText({ user: userMeta, trades: tradesByDate[d] }, d, marketDataMap);
            let profit = 0;
            for (const line of text.split('\n')) {
                if (/^(買|賣)/.test(line) && line.includes(' 股 ')) continue;
                for (const m of line.matchAll(PROFIT_RE)) {
                    profit += parseFloat(m[1].replace(/,/g, ''));
                }
            }
            profitByDate[d] = profit;
        }
        // One point per ACTUAL trading day in the window; no-trade days → 0.
        const history = tradingDays.map(d => {
            const qqq = qqqByDate[d];
            return {
                date: d,
                profit: profitByDate[d] ?? 0,
                qqqOpen: qqq?.open ?? null,
                qqqClose: qqq?.close ?? null,
            };
        });

        // Trades already query from startDateStr (the window's first trading
        // day), so `history` is exactly the trade-days inside the window —
        // no slice needed. This is what aligns the profit chart's left edge
        // with the cash chart's.
        const trimmed = history;

        // Cash-balance trend over the SAME 30 trading days. Pull DAILY_NET_EQUITY
        // (incl. a little history before the window so the first day can
        // carry-forward a prior balance), then map onto every trading day —
        // a day without its own row inherits the most recent prior balance.
        const { results: cashRows } = await db.prepare(`
            SELECT date(datetime(date, 'unixepoch')) AS d, cash_balance
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND date(datetime(date, 'unixepoch')) <= ?
            ORDER BY date ASC
        `).bind(user.id, endDateStr).all<{ d: string; cash_balance: number | null }>();
        const cashByDate: Record<string, number> = {};
        for (const r of cashRows || []) {
            if (r.cash_balance != null) cashByDate[r.d] = r.cash_balance;
        }
        let carried: number | null = null;
        // Seed carry-forward with the latest balance on/before the window start.
        for (const r of cashRows || []) {
            if (r.d <= startDateStr && r.cash_balance != null) carried = r.cash_balance;
        }
        const cashHistory = tradingDays.map(d => {
            if (cashByDate[d] != null) carried = cashByDate[d];
            return { date: d, cash: carried ?? 0 };
        });

        return NextResponse.json({ history: trimmed, cashHistory });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed';
        console.error('Failed to fetch daily-trades history:', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
