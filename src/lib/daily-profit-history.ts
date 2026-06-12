/**
 * Per-day option 收益 for one user over a date window, computed with the
 * EXACT same path the daily-trades chart uses: render each day's trades
 * via generateDailyTradesText, then regex-sum the 收益 / 權利金 amounts
 * (option lines only — stock 收益 lines are skipped).
 *
 * Returns a date→profit map for the days that had trades. Callers that
 * want a trading-day-based series (zero-filling no-trade days) intersect
 * this with their own trading-day calendar.
 *
 * Extracted so /api/daily-trades/history and the daily-report builder
 * stay byte-for-byte consistent with the on-screen chart.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { generateDailyTradesText, DailyTradeRow, UserDailyTradesGroup } from '@/lib/daily-trades-text';

const PROFIT_RE = /(?:收益|權利金)\s*([+-]?[\d,]+(?:\.\d+)?)/g;

export async function computeDailyOptionProfits(
    db: D1Database,
    user: { id: number; user_id?: string | null; name?: string | null },
    startDateStr: string,
    endDateStr: string,
): Promise<Record<string, number>> {
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

    const userMeta: UserDailyTradesGroup['user'] = {
        id: user.id,
        user_id: user.user_id,
        name: user.name,
    };

    const out: Record<string, number> = {};
    for (const d of Object.keys(tradesByDate)) {
        const text = generateDailyTradesText({ user: userMeta, trades: tradesByDate[d] }, d, marketDataMap);
        let profit = 0;
        for (const line of text.split('\n')) {
            if (/^(買|賣)/.test(line) && line.includes(' 股 ')) continue;
            for (const m of line.matchAll(PROFIT_RE)) {
                profit += parseFloat(m[1].replace(/,/g, ''));
            }
        }
        out[d] = profit;
    }
    return out;
}
