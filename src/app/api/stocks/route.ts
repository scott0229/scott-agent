
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');
        const ownerId = searchParams.get('ownerId');
        const year = searchParams.get('year');
        const symbol = searchParams.get('symbol');

        const db = await getDb();
        let query = `
            SELECT ST.*, U.user_id as user_name 
            FROM STOCK_TRADES ST
            JOIN USERS U ON ST.owner_id = U.id
        `;
        const params: any[] = [];
        let whereAdded = false;

        // Add year filter
        if (year && year !== 'All') {
            query += ' WHERE ST.year = ?';
            params.push(parseInt(year));
            whereAdded = true;
        }

        if (ownerId) {
            query += whereAdded ? ' AND ST.owner_id = ?' : ' WHERE ST.owner_id = ?';
            params.push(ownerId);
            whereAdded = true;
        } else if (userId) {
            query += whereAdded ? ' AND ST.user_id = ?' : ' WHERE ST.user_id = ?';
            params.push(userId);
            whereAdded = true;
        }

        if (symbol) {
            query += whereAdded ? ' AND ST.symbol = ?' : ' WHERE ST.symbol = ?';
            params.push(symbol);
            whereAdded = true;
        }

        query += ' ORDER BY ST.open_date DESC';

        const { results } = await db.prepare(query).bind(...params).all();

        return NextResponse.json({ trades: results });
    } catch (error) {
        console.error('Fetch stocks error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();

        const {
            symbol,
            status, // 'Holding' or 'Closed'
            open_date,
            close_date,
            open_price,
            close_price,
            quantity,
            userId, // API specific
            ownerId, // Database specific
            year
        } = body;

        if (!symbol || !open_date || !open_price || !quantity) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const db = await getDb();
        const tradeYear = year || new Date().getFullYear();

        const result = await db.prepare(`
            INSERT INTO STOCK_TRADES (
                symbol, status, open_date, close_date,
                open_price, close_price, quantity,
                user_id, owner_id, year, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        `).bind(
            symbol,
            status || 'Holding',
            open_date,
            close_date || null,
            open_price,
            close_price || null,
            quantity,
            userId || null,
            ownerId || null,
            tradeYear
        ).run();

        return NextResponse.json({ success: true, id: result.meta.last_row_id });
    } catch (error: any) {
        console.error('Create stock trade error:', error);
        return NextResponse.json({ error: error.message || '伺服器內部錯誤' }, { status: 500 });
    }
}
