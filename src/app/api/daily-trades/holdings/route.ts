/**
 * Point-in-time holdings for the daily-trades page's single-account
 * mode. Returns the option + stock positions still held at END of the
 * given calendar date, reconstructed purely from dated columns:
 *
 *   held on D  ⇔  open_date <= D  AND  (settlement/close > D or null)
 *
 * No mark-to-market, TWR, or interest math involved — this is the
 * cheap subset of the daily report that CAN be reproduced for any
 * historical date. marketData carries each symbol's close as of D so
 * the client can paint a 被突破 indicator with the price that was
 * true THAT day, not today's.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const payload = await verifyToken(req.cookies.get('token')?.value || '');
        if (!payload || !['admin', 'manager', 'customer'].includes(payload.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const userIdStr = searchParams.get('user_id'); // string user_id, matches the page's selectedAccount
        const dateStr = searchParams.get('date');      // YYYY-MM-DD
        const yearStr = searchParams.get('year');
        if (!userIdStr || !dateStr) {
            return NextResponse.json({ error: 'Missing user_id or date' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Resolve user_id (string alias) → numeric id. USERS holds ONE ROW
        // PER YEAR per account (ck.380 exists as a 2025 id AND a 2026 id),
        // so the lookup MUST be year-scoped — an unscoped .first() can land
        // on the prior year's row, whose owner_id holds stale carried-over
        // stock rows and only expired options. Mirrors the history route.
        let userQuery = `SELECT id, user_id FROM USERS WHERE user_id = ? AND email != 'admin'`;
        const userParams: (string | number)[] = [userIdStr];
        if (yearStr && yearStr !== 'All') {
            userQuery += ` AND year = ?`;
            userParams.push(parseInt(yearStr, 10));
        }
        if (payload.role === 'customer') {
            // Customers can only inspect their own holdings.
            userQuery += ` AND id = ?`;
            userParams.push(payload.userId);
        }
        const user = await db.prepare(userQuery).bind(...userParams).first<{ id: number; user_id: string }>();
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Options held at end of day D. The extra to_date guard drops
        // contracts that had already expired before D but whose
        // settlement row hadn't been recorded yet (import lag) — they
        // can't have been holdings on D. to_date == D stays in: the
        // position exists during D's session and the daily report's
        // current-day view shows it the same way.
        // Ordering mirrors the daily report's 持有期權 section:
        // sellers first, QQQ → QLD → TQQQ → others, CALL before PUT,
        // expiry ASC, group.
        const { results: options } = await db.prepare(`
            SELECT SUM(quantity) as quantity, to_date, type, underlying, strike_price, group_id as trade_group
            FROM OPTIONS
            WHERE owner_id = ?
              AND date(datetime(open_date, 'unixepoch')) <= ?
              AND (settlement_date IS NULL OR date(datetime(settlement_date, 'unixepoch')) > ?)
              AND (to_date IS NULL OR date(datetime(to_date, 'unixepoch')) >= ?)
            GROUP BY to_date, underlying, type, strike_price, group_id
            HAVING SUM(quantity) != 0
            ORDER BY
                CASE WHEN SUM(quantity) < 0 THEN 1 ELSE 2 END,
                CASE underlying
                    WHEN 'QQQ' THEN 1
                    WHEN 'QLD' THEN 2
                    WHEN 'TQQQ' THEN 3
                    ELSE 4
                END,
                underlying,
                CASE type WHEN 'CALL' THEN 1 WHEN 'PUT' THEN 2 ELSE 3 END,
                to_date, group_id
        `).bind(user.id, dateStr, dateStr, dateStr).all();

        // Stock positions held at end of day D.
        const { results: stocks } = await db.prepare(`
            SELECT symbol, SUM(quantity) as quantity
            FROM STOCK_TRADES
            WHERE owner_id = ?
              AND date(datetime(open_date, 'unixepoch')) <= ?
              AND (close_date IS NULL OR date(datetime(close_date, 'unixepoch')) > ?)
            GROUP BY symbol
            HAVING SUM(quantity) != 0
            ORDER BY
                CASE symbol
                    WHEN 'QQQ' THEN 1
                    WHEN 'QLD' THEN 2
                    WHEN 'TQQQ' THEN 3
                    ELSE 4
                END,
                symbol
        `).bind(user.id, dateStr, dateStr).all();

        // Per-symbol close as of D (latest bar on or before D) so the
        // breach indicator reflects that day's market, not today's.
        const { results: marketPrices } = await db.prepare(`
            SELECT symbol, close_price FROM market_prices
            WHERE date(datetime(date, 'unixepoch')) <= ?
            AND date = (
                SELECT MAX(date) FROM market_prices AS mp2
                WHERE mp2.symbol = market_prices.symbol
                AND date(datetime(mp2.date, 'unixepoch')) <= ?
            )
        `).bind(dateStr, dateStr).all();

        const marketData: Record<string, number> = {};
        (marketPrices as any[] | undefined)?.forEach(mp => {
            marketData[mp.symbol] = mp.close_price;
        });

        return NextResponse.json({
            success: true,
            options: options || [],
            stocks: stocks || [],
            marketData,
        });
    } catch (error: any) {
        console.error('Failed to fetch holdings:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
