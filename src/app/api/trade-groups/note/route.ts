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

        const { ownerId, year, name, note, note_color } = await req.json();

        if (!ownerId || !year || !name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // We use INSERT ON CONFLICT DO UPDATE because a TRADE_GROUPS entry might not exist yet if only its note is being set before its status.
        await db.prepare(`
            INSERT INTO TRADE_GROUPS (owner_id, year, name, note, note_color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
            ON CONFLICT(owner_id, year, name) DO UPDATE SET 
                note = CASE WHEN ? THEN ? ELSE note END,
                note_color = CASE WHEN ? THEN ? ELSE note_color END,
                updated_at = unixepoch()
        `).bind(
            ownerId, year, name, 
            note !== undefined ? note : null, 
            note_color !== undefined ? note_color : null,
            note !== undefined ? 1 : 0, note !== undefined ? note : null,
            note_color !== undefined ? 1 : 0, note_color !== undefined ? note_color : null
        ).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update trade group note error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
