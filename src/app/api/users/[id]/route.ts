import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// Helper to check for admin or manager role
async function checkAdmin(req: NextRequest) {
    const token = req.cookies.get('token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'manager')) {
        return null;
    }
    return payload;
}

// DELETE: Delete user by ID
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { id } = await params;

        if (!id) {
            return NextResponse.json({ error: '缺少使用者 ID' }, { status: 400 });
        }

        // Prevent deleting self
        if (Number(id) === admin.id) {
            return NextResponse.json({ error: '不能刪除自己' }, { status: 400 });
        }

        const db = await getDb();

        // 1. Delete user's trading records (OPTIONS)
        await db.prepare('DELETE FROM OPTIONS WHERE owner_id = ?').bind(id).run();

        // 2. Unassign items assigned to this user (set assignee_id to NULL)
        await db.prepare('UPDATE ITEMS SET assignee_id = NULL WHERE assignee_id = ?').bind(id).run();

        // 3. Delete user's projects (CASCADE will delete items they created)
        await db.prepare('DELETE FROM PROJECTS WHERE user_id = ?').bind(id).run();

        // 4. Delete user's project assignments
        await db.prepare('DELETE FROM PROJECT_USERS WHERE user_id = ?').bind(id).run();

        // 5. Now delete the user
        await db.prepare('DELETE FROM USERS WHERE id = ?').bind(id).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete user error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
