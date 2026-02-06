
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { customAlphabet } from 'nanoid';

// Generate 5-character uppercase alphanumeric code
const generateCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);

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

        // Get today's date at midnight UTC for market price lookup
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const todayTimestamp = Math.floor(today.getTime() / 1000);

        let query = `
            SELECT 
                ST.*, 
                U.user_id as user_name,
                MP.close_price as current_market_price,
                UserMaxDate.max_open_date
            FROM STOCK_TRADES ST
            JOIN USERS U ON ST.owner_id = U.id
            LEFT JOIN (
                SELECT symbol, close_price
                FROM market_prices
                WHERE (symbol, date) IN (
                    SELECT symbol, MAX(date) as latest_date
                    FROM market_prices
                    WHERE date <= ?
                    GROUP BY symbol
                )
            ) MP ON ST.symbol = MP.symbol
            LEFT JOIN (
                SELECT owner_id, status, year, MAX(open_date) as max_open_date
                FROM STOCK_TRADES
                GROUP BY owner_id, status, year
            ) UserMaxDate ON ST.owner_id = UserMaxDate.owner_id AND ST.status = UserMaxDate.status AND ST.year = UserMaxDate.year
        `;
        const params: any[] = [todayTimestamp];
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

        // Sort by: status (Holding first), then user's latest open_date, then individual open_date
        query += ` ORDER BY ST.status DESC, UserMaxDate.max_open_date DESC, ST.open_date DESC`;

        const { results } = await db.prepare(query).bind(...params).all();

        return NextResponse.json({ stocks: results });
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

        // Generate unique code
        let code = generateCode();
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 10;

        // Ensure code is unique
        while (!isUnique && attempts < maxAttempts) {
            const existing = await db.prepare('SELECT id FROM STOCK_TRADES WHERE code = ?').bind(code).first();
            if (!existing) {
                isUnique = true;
            } else {
                code = generateCode();
                attempts++;
            }
        }

        if (!isUnique) {
            return NextResponse.json({ error: 'Failed to generate unique code' }, { status: 500 });
        }

        const result = await db.prepare(`
            INSERT INTO STOCK_TRADES (
                symbol, status, open_date, close_date,
                open_price, close_price, quantity,
                user_id, owner_id, year, code, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
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
            tradeYear,
            code
        ).run();

        return NextResponse.json({ success: true, id: result.meta.last_row_id });
    } catch (error: any) {
        console.error('Create stock trade error:', error);
        return NextResponse.json({ error: error.message || '伺服器內部錯誤' }, { status: 500 });
    }
}
