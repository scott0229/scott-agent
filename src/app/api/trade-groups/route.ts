import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const ownerId = searchParams.get('ownerId');
        const year = searchParams.get('year');

        if (!ownerId || !year) {
            return NextResponse.json({ error: 'Missing ownerId or year' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        const { results } = await db.prepare('SELECT * FROM TRADE_GROUPS WHERE owner_id = ? AND year = ?')
            .bind(ownerId, year)
            .all();

        return NextResponse.json({ groups: results });
    } catch (error) {
        console.error('Fetch trade groups error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;
        // Customers are not allowed to update group status
        if (!user || user.role === 'customer') {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { ownerId, year, name, status } = await req.json();

        if (!ownerId || !year || !name || !status) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        await db.prepare(`
            INSERT INTO TRADE_GROUPS (owner_id, year, name, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
            ON CONFLICT(owner_id, year, name) DO UPDATE SET 
                status = excluded.status,
                updated_at = unixepoch()
        `).bind(ownerId, year, name, status).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update trade group error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
