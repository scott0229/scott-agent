import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { clearUserSelectionCache } from '@/lib/user-cache';
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

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        // LEFT JOIN market_prices_minute on (symbol, date, ET HH:MM) so
        // 當時股價 prefers the minute cache (fresh, accurate) and falls
        // back to OPTIONS.underlying_price only when the cache misses
        // (older than the 60-day Yahoo horizon, or the minute wasn't
        // resolved on the daily-trades read). Listing every column
        // explicitly so we can swap underlying_price for the COALESCE
        // without a duplicate-name collision against o.*. This removes
        // the need to ever rewrite underlying_price on the OPTIONS
        // table — single source of truth lives in market_prices_minute.
        let query = `
            SELECT o.id, o.status, o.operation, o.open_date, o.to_date,
                   o.settlement_date, o.days_to_expire, o.days_held,
                   o.quantity, o.underlying, o.type, o.strike_price,
                   o.collateral, o.premium, o.final_profit, o.profit_percent,
                   o.delta, o.iv, o.capital_efficiency, o.created_at,
                   o.updated_at, o.user_id, o.owner_id, o.year, o.code,
                   o.note_color, o.note, o.has_separator, o.group_id,
                   COALESCE(m.close, o.underlying_price) AS underlying_price,
                   LP.close_price AS current_market_price
            FROM OPTIONS o
            LEFT JOIN market_prices_minute m
              ON m.symbol = o.underlying
             AND m.date_str = date(datetime(o.open_date, 'unixepoch'))
             AND m.hhmm = strftime('%H:%M', datetime(o.open_date, 'unixepoch'))
            LEFT JOIN (
                SELECT symbol, close_price
                FROM market_prices mp1
                WHERE date = (SELECT MAX(date) FROM market_prices mp2 WHERE mp2.symbol = mp1.symbol)
            ) LP ON LP.symbol = o.underlying
        `;
        const params: any[] = [];
        let whereAdded = false;

        // Add year filter
        if (year && year !== 'All') {
            query += ' WHERE o.year = ?';
            params.push(parseInt(year));
            whereAdded = true;
        }

        if (ownerId) {
            query += whereAdded ? ' AND o.owner_id = ?' : ' WHERE o.owner_id = ?';
            params.push(ownerId);
            whereAdded = true;
        } else if (userId) {
            query += whereAdded ? ' AND o.user_id = ?' : ' WHERE o.user_id = ?';
            params.push(userId);
        }

        query += ' ORDER BY o.open_date DESC';

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
            year, // Add year
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

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
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
                delta, iv, capital_efficiency, underlying_price, user_id, owner_id, year, code, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
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
            body.underlying_price || null,
            userId || null,
            ownerId || null, // Bind ownerId
            optionYear,
            code
        ).run();

        clearUserSelectionCache();
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
            premium,
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

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        await db.prepare(`
            UPDATE OPTIONS SET
                operation = ?, open_date = ?, to_date = ?, settlement_date = ?,
                quantity = ?, underlying = ?, type = ?, strike_price = ?,
                collateral = ?, premium = ?, final_profit = ?, profit_percent = ?,
                delta = ?, iv = ?, capital_efficiency = ?, underlying_price = ?,
                updated_at = unixepoch()
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
            body.underlying_price || null,
            id
        ).run();

        console.log('Update result:', { id, final_profit: body.final_profit, premium, profit_percent });

        clearUserSelectionCache();
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
        const ownerId = searchParams.get('ownerId');
        const year = searchParams.get('year');

        if ((!userId && !ownerId) || !year) {
            return NextResponse.json({ error: 'Missing userId/ownerId or year' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        let query = 'DELETE FROM OPTIONS WHERE ';
        const params: any[] = [];

        // Use ownerId if provided, otherwise fallback to user_id
        if (ownerId) {
            query += 'owner_id = ?';
            params.push(parseInt(ownerId));
        } else {
            query += 'user_id = ?';
            params.push(userId);
        }

        // Handle 'All' year — delete all years
        if (year !== 'All') {
            query += ' AND year = ?';
            params.push(parseInt(year));
        }

        const result = await db.prepare(query).bind(...params).all();

        clearUserSelectionCache();
        return NextResponse.json({ success: true, deleted: result.meta.changes });
    } catch (error) {
        console.error('Delete all options error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
