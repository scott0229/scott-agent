import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { clearUserSelectionCache } from '@/lib/user-cache';

export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = Number(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
        }

        const body = await req.json();
        const { group_id, tradeSide } = body;

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        const targetGroupColumn = tradeSide === 'C' ? 'close_group_id' : 'group_id';

        const query = `UPDATE STOCK_TRADES SET ${targetGroupColumn} = ?, updated_at = unixepoch() WHERE id = ?`;
        await db.prepare(query).bind(group_id !== undefined ? group_id : null, id).run();

        clearUserSelectionCache();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update stock group error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
