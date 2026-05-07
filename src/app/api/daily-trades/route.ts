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
            SELECT id, owner_id, symbol, quantity, open_price as price, 'stock' as asset_type, 'open' as action_type
            FROM STOCK_TRADES
            WHERE date(datetime(open_date, 'unixepoch')) = ? AND owner_id IN (${userIds.join(',')})
        `).bind(dateStr).all();

        // 2. Stock Closes (Sells)
        const { results: stockCloses } = await db.prepare(`
            SELECT id, owner_id, symbol, quantity, close_price as price, 'stock' as asset_type, 'close' as action_type, close_source
            FROM STOCK_TRADES
            WHERE close_date IS NOT NULL AND date(datetime(close_date, 'unixepoch')) = ? AND owner_id IN (${userIds.join(',')})
        `).bind(dateStr).all();

        // 3. Option Opens
        const { results: optionOpens } = await db.prepare(`
            SELECT id, owner_id, underlying as symbol, type as option_type, strike_price, quantity, premium as price, 'option' as asset_type, 'open' as action_type, to_date
            FROM OPTIONS
            WHERE date(datetime(open_date, 'unixepoch')) = ? AND owner_id IN (${userIds.join(',')})
        `).bind(dateStr).all();

        // 4. Option Closes/Settlements
        const { results: optionCloses } = await db.prepare(`
            SELECT id, owner_id, underlying as symbol, type as option_type, strike_price, quantity, final_profit as profit, premium as old_premium, 'option' as asset_type, 'close' as action_type, to_date
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

        return NextResponse.json({ data: groupedData });
    } catch (error: any) {
        console.error('Failed to fetch daily trades:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
