import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export async function PATCH(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;
        if (!user || user.role === 'customer') {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { ownerId, year, name, next_group } = await req.json();

        if (!ownerId || !year || !name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        await db.prepare(`
            INSERT INTO TRADE_GROUPS (owner_id, year, name, next_group, updated_at)
            VALUES (?, ?, ?, ?, unixepoch())
            ON CONFLICT(owner_id, year, name) DO UPDATE SET 
                next_group = excluded.next_group,
                updated_at = unixepoch()
        `).bind(ownerId, year, name, next_group || null).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update next_group error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
