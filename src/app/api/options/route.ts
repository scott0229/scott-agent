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

        const db = await getDb();
        let query = 'SELECT * FROM OPTIONS';
        const params: any[] = [];

        if (ownerId) {
            query += ' WHERE owner_id = ?';
            params.push(ownerId);
        } else if (userId) {
            query += ' WHERE user_id = ?';
            params.push(userId);
        }

        query += ' ORDER BY open_date DESC';

        const { results } = await db.prepare(query).bind(...params).all();

        return NextResponse.json({ options: results });
    } catch (error) {
        console.error('Fetch options error:', error);
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

        // Required fields
        const {
            status,
            operation,
            open_date,
            to_date,
            quantity,
            underlying,
            type,
            strike_price,
            premium,
            userId,
            ownerId // Add ownerId
        } = body;

        // Auto-calculate profit percent
        let profit_percent = body.profit_percent;
        if (body.final_profit !== undefined && body.final_profit !== null && premium && premium !== 0) {
            profit_percent = body.final_profit / premium;
        } else if (body.final_profit === null) {
            profit_percent = null;
        }

        if (!open_date || !quantity || !underlying || !type || !strike_price) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const db = await getDb();

        const result = await db.prepare(`
            INSERT INTO OPTIONS (
                status, operation, open_date, to_date, settlement_date, 
                quantity, underlying, type, strike_price, 
                collateral, premium, final_profit, profit_percent, 
                delta, iv, capital_efficiency, user_id, owner_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        `).bind(
            status || 'Open',
            operation || '無',
            open_date,
            to_date || null,
            body.settlement_date || null,
            quantity,
            underlying,
            type,
            strike_price,
            body.collateral || 0,
            premium || 0,
            body.final_profit || null,
            profit_percent || null,
            body.delta || null,
            body.iv || null,
            body.capital_efficiency || null,
            userId || null,
            ownerId || null // Bind ownerId
        ).run();

        return NextResponse.json({ success: true, id: result.meta.last_row_id });
    } catch (error: any) {
        console.error('Create option error:', error);
        return NextResponse.json({ error: error.message || '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();

        // Required fields for update
        const {
            id,
            status,
            operation,
            open_date,
            to_date,
            quantity,
            underlying,
            type,
            strike_price,
            premium
        } = body;

        // Auto-calculate profit percent
        let profit_percent = body.profit_percent;
        if (body.final_profit !== undefined && body.final_profit !== null && premium && premium !== 0) {
            profit_percent = body.final_profit / premium;
        } else if (body.final_profit === null) {
            profit_percent = null;
        }

        if (!id || !open_date || !quantity || !underlying || !type || !strike_price) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const db = await getDb();

        await db.prepare(`
            UPDATE OPTIONS SET
                status = ?, operation = ?, open_date = ?, to_date = ?, settlement_date = ?,
                quantity = ?, underlying = ?, type = ?, strike_price = ?,
                collateral = ?, premium = ?, final_profit = ?, profit_percent = ?,
                delta = ?, iv = ?, capital_efficiency = ?, updated_at = unixepoch()
            WHERE id = ?
        `).bind(
            status,
            operation,
            open_date,
            to_date || null,
            body.settlement_date || null,
            quantity,
            underlying,
            type,
            strike_price,
            body.collateral || 0,
            premium || 0,
            body.final_profit || null,
            profit_percent || null,
            body.delta || null,
            body.iv || null,
            body.capital_efficiency || null,
            id
        ).run();

        console.log('Update result:', { id, final_profit: body.final_profit, premium, profit_percent });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update option error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
