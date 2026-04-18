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
        const { note, note_color } = body;

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        const updates = [];
        const binds = [];
        if (note !== undefined) {
            updates.push('note = ?');
            binds.push(note || null);
        }
        if (note_color !== undefined) {
            updates.push('note_color = ?');
            binds.push(note_color || null);
        }

        if (updates.length > 0) {
            const query = `UPDATE OPTIONS SET ${updates.join(', ')}, updated_at = unixepoch() WHERE id = ?`;
            binds.push(id);
            await db.prepare(query).bind(...binds).run();
        }

        clearUserSelectionCache();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update option note error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
