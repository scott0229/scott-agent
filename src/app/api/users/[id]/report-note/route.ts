import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const token = req.cookies.get('token')?.value;
        if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const payload = await verifyToken(token);
        if (!payload || !['admin', 'manager', 'trader'].includes(payload.role)) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { reportNote } = await req.json();
        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        await db.prepare('UPDATE USERS SET report_note = ? WHERE id = ?')
            .bind(reportNote || null, params.id)
            .run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update report note error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
