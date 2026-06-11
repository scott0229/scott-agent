/**
 * Point-in-time holdings for the daily-trades page's single-account
 * mode. Returns the option + stock positions still held at END of the
 * given calendar date, reconstructed purely from dated columns:
 *
 *   held on D  ⇔  open_date <= D  AND  (settlement/close > D or null)
 *
 * No mark-to-market, TWR, or interest math involved — this is the
 * cheap subset of the daily report that CAN be reproduced for any
 * historical date. Rows opened ON the viewed date carry a
 * traded_today flag so the card can highlight which holdings came
 * from that day's activity.
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
        // traded_today flags groups where ANY contributing leg was
        // opened ON the viewed date — the card highlights those rows.
        // Ordering mirrors the daily report's 持有期權 section:
        // sellers first, QQQ → QLD → TQQQ → others, CALL before PUT,
        // expiry ASC, group.
        const { results: options } = await db.prepare(`
            SELECT SUM(quantity) as quantity, to_date, type, underlying, strike_price, group_id as trade_group,
                   MAX(CASE WHEN date(datetime(open_date, 'unixepoch')) = ? THEN 1 ELSE 0 END) as traded_today
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
        `).bind(dateStr, user.id, dateStr, dateStr, dateStr).all();

        // Stock positions held at end of day D, with the same
        // bought-on-D highlight flag.
        const { results: stocks } = await db.prepare(`
            SELECT symbol, SUM(quantity) as quantity,
                   MAX(CASE WHEN date(datetime(open_date, 'unixepoch')) = ? THEN 1 ELSE 0 END) as traded_today
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
        `).bind(dateStr, user.id, dateStr, dateStr).all();

        // Cash balance as of D — DAILY_NET_EQUITY is one row per trading
        // day, already scoped to this per-year user id. Latest row on or
        // before D covers weekends/holidays (carries Friday's balance).
        const equityRow = await db.prepare(`
            SELECT cash_balance, net_equity
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND date(datetime(date, 'unixepoch')) <= ?
            ORDER BY date DESC
            LIMIT 1
        `).bind(user.id, dateStr).first<{ cash_balance: number | null; net_equity: number | null }>();

        return NextResponse.json({
            success: true,
            options: options || [],
            stocks: stocks || [],
            cash: equityRow?.cash_balance ?? null,
        });
    } catch (error: any) {
        console.error('Failed to fetch holdings:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
