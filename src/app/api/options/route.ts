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

        const db = await getDb();
        let query = 'SELECT * FROM OPTIONS';
        const params: any[] = [];
        let whereAdded = false;

        // Add year filter
        if (year && year !== 'All') {
            query += ' WHERE year = ?';
            params.push(parseInt(year));
            whereAdded = true;
        }

        if (ownerId) {
            query += whereAdded ? ' AND owner_id = ?' : ' WHERE owner_id = ?';
            params.push(ownerId);
            whereAdded = true;
        } else if (userId) {
            query += whereAdded ? ' AND user_id = ?' : ' WHERE user_id = ?';
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
            operation,
            open_date,
            to_date,
            quantity,
            underlying,
            type,
            strike_price,
            premium,
            userId,
            ownerId, // Add ownerId
            year // Add year
        } = body;

        // Auto-fill final_profit with premium if operation is '新開倉' (New Opening)
        let final_profit = body.final_profit;
        if (operation === '新開倉' && (final_profit === undefined || final_profit === null)) {
            final_profit = premium;
        }

        // Auto-calculate profit percent
        let profit_percent = body.profit_percent;
        if (final_profit !== undefined && final_profit !== null && premium && premium !== 0) {
            profit_percent = final_profit / premium;
        } else if (final_profit === null) {
            profit_percent = null;
        }

        if (!open_date || !quantity || !underlying || !type || !strike_price) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const db = await getDb();
        const optionYear = year || new Date().getFullYear();

        // Generate unique code that doesn't conflict with stock trade codes
        let code = generateCode();
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 20;

        // Ensure code is unique across both OPTIONS and STOCK_TRADES tables
        while (!isUnique && attempts < maxAttempts) {
            const existingOption = await db.prepare('SELECT id FROM OPTIONS WHERE code = ?').bind(code).first();
            const existingStock = await db.prepare('SELECT id FROM STOCK_TRADES WHERE code = ?').bind(code).first();

            if (!existingOption && !existingStock) {
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
            INSERT INTO OPTIONS (
                operation, open_date, to_date, settlement_date, 
                quantity, underlying, type, strike_price, 
                collateral, premium, final_profit, profit_percent, 
                delta, iv, capital_efficiency, user_id, owner_id, year, code, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        `).bind(
            operation || '新開倉',
            open_date,
            to_date || null,
            body.settlement_date || null,
            quantity,
            underlying,
            type,
            strike_price,
            body.collateral || 0,
            premium || 0,
            final_profit || null,
            profit_percent || null,
            body.delta || null,
            body.iv || null,
            body.capital_efficiency || null,
            userId || null,
            ownerId || null, // Bind ownerId
            optionYear,
            code
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
                operation = ?, open_date = ?, to_date = ?, settlement_date = ?,
                quantity = ?, underlying = ?, type = ?, strike_price = ?,
                collateral = ?, premium = ?, final_profit = ?, profit_percent = ?,
                delta = ?, iv = ?, capital_efficiency = ?, updated_at = unixepoch()
            WHERE id = ?
        `).bind(
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

export async function DELETE(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');
        const year = searchParams.get('year');

        if (!userId || !year) {
            return NextResponse.json({ error: 'Missing userId or year' }, { status: 400 });
        }

        const db = await getDb();
        const result = await db.prepare('DELETE FROM OPTIONS WHERE user_id = ? AND year = ?')
            .bind(userId, parseInt(year))
            .run();

        return NextResponse.json({ success: true, deleted: result.meta.changes });
    } catch (error) {
        console.error('Delete all options error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
