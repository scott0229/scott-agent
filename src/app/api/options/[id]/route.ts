import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { clearUserSelectionCache } from '@/lib/user-cache';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json();
        const { action, settlement_date } = body;
        const id = Number(params.id);

        if (action === 'transfer' && id && settlement_date) {
            const group = await getGroupFromRequest(req);
            const db = await getDb(group);

            await db.prepare(`
                UPDATE OPTIONS SET
                    status = 'Closed', operation = 'Transferred', settlement_date = ?, final_profit = 0, updated_at = unixepoch()
                WHERE id = ?
            `).bind(settlement_date, id).run();

            clearUserSelectionCache();
            return NextResponse.json({ success: true });
        }
        return NextResponse.json({ error: 'Invalid operation' }, { status: 400 });
    } catch (error) {
        console.error('Update option error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function DELETE(
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

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        await db.prepare('DELETE FROM OPTIONS WHERE id = ?').bind(id).run();

        clearUserSelectionCache();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete option error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
