import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Reuse the same API key auth as trader-settings
async function checkApiKey(req: NextRequest): Promise<boolean> {
    const { searchParams } = new URL(req.url);
    const qKey = searchParams.get('apiKey');
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    const key = qKey || headerKey;
    if (!key) return false;

    const db = await getDb();
    const row = await db.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    return !!row;
}

// GET /api/trader-options?alias=ck.380
// Returns: user info, option trades, stock trades, net equity (last 30 days)
export async function GET(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req);
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const alias = searchParams.get('alias');

        if (!alias) {
            return NextResponse.json({ error: 'Missing alias parameter' }, { status: 400 });
        }

        const db = await getDb();

        // Find user by user_id (alias) — get the latest year entry
        const user = await db.prepare(
            "SELECT id, user_id, name, ib_account, year FROM USERS WHERE user_id = ? ORDER BY year DESC LIMIT 1"
        ).bind(alias).first() as { id: number; user_id: string; name: string; ib_account: string; year: number } | null;

        if (!user) {
            return NextResponse.json({ error: `User not found: ${alias}` }, { status: 404 });
        }

        const ownerId = user.id;

        // Fetch option trades (last 100, sorted by open_date DESC)
        const { results: options } = await db.prepare(
            `SELECT id, status, operation, open_date, to_date, quantity, underlying, type, 
                    strike_price, premium, final_profit, profit_percent, delta, iv
             FROM OPTIONS 
             WHERE owner_id = ? 
             ORDER BY open_date DESC 
             LIMIT 100`
        ).bind(ownerId).all();

        // Fetch stock trades (last 50)
        const { results: stockTrades } = await db.prepare(
            `SELECT id, symbol, status, open_date, close_date, open_price, close_price, quantity
             FROM STOCK_TRADES 
             WHERE owner_id = ? 
             ORDER BY open_date DESC 
             LIMIT 50`
        ).bind(ownerId).all();

        // Fetch net equity (last 30 trading days)
        const { results: netEquity } = await db.prepare(
            `SELECT date, net_equity, cash_balance
             FROM DAILY_NET_EQUITY 
             WHERE user_id = ? 
             ORDER BY date DESC 
             LIMIT 30`
        ).bind(ownerId).all();

        return NextResponse.json({
            user: {
                id: user.id,
                userId: user.user_id,
                name: user.name,
                ibAccount: user.ib_account,
                year: user.year
            },
            options,
            stockTrades,
            netEquity
        });
    } catch (error) {
        console.error('GET trader-options error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
