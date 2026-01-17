import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// Helper to check for admin or manager role (trader excluded from modifications)
async function checkAdmin(req: NextRequest) {
    const token = req.cookies.get('token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'manager')) {
        return null;
    }
    return payload;
}

// GET: Get user by ID
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            // Allow self-fetch? 
            // Ideally yes, but for now strict admin check as per other methods?
            // But the frontend calls this for header.
            // If a customer views their own page, they need to fetch their own name?
            // Or maybe they already know it.
            // Let's allow if admin OR if id matches self.
            const token = req.cookies.get('token')?.value;
            if (token) {
                const payload = await verifyToken(token);
                const { id } = await params;
                if (payload && (payload.role === 'admin' || payload.role === 'manager' || payload.id === Number(id))) {
                    // Authorized
                } else {
                    return NextResponse.json({ error: '權限不足' }, { status: 403 });
                }
            } else {
                return NextResponse.json({ error: '未登入' }, { status: 401 });
            }
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: '缺少使用者 ID' }, { status: 400 });
        }

        const db = await getDb();
        const user = await db.prepare('SELECT id, user_id, email, role, initial_cost FROM USERS WHERE id = ?').bind(id).first();

        if (!user) {
            return NextResponse.json({ error: '使用者不存在' }, { status: 404 });
        }

        return NextResponse.json({ success: true, user });
    } catch (error) {
        console.error('Get user error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
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

        // 2. Delete user's deposits
        await db.prepare('DELETE FROM DEPOSITS WHERE user_id = ?').bind(id).run();

        // 3. Delete user's monthly interest records
        await db.prepare('DELETE FROM monthly_interest WHERE user_id = ?').bind(id).run();

        // 4. Delete user's daily net equity records
        await db.prepare('DELETE FROM DAILY_NET_EQUITY WHERE user_id = ?').bind(id).run();

        // 5. Delete or update comments created/updated by this user
        await db.prepare('DELETE FROM COMMENTS WHERE created_by = ? OR updated_by = ?').bind(id, id).run();

        // 6. Set created_by to NULL for deposits created by this user
        await db.prepare('UPDATE DEPOSITS SET created_by = NULL WHERE created_by = ?').bind(id).run();

        // 7. Set created_by/updated_by to NULL for items created/updated by this user
        await db.prepare('UPDATE ITEMS SET created_by = NULL WHERE created_by = ?').bind(id).run();
        await db.prepare('UPDATE ITEMS SET updated_by = NULL WHERE updated_by = ?').bind(id).run();

        // 8. Unassign items assigned to this user (set assignee_id to NULL)
        await db.prepare('UPDATE ITEMS SET assignee_id = NULL WHERE assignee_id = ?').bind(id).run();

        // 9. Delete user's projects (CASCADE will delete items they created)
        await db.prepare('DELETE FROM PROJECTS WHERE user_id = ?').bind(id).run();

        // 10. Delete user's project assignments
        await db.prepare('DELETE FROM PROJECT_USERS WHERE user_id = ?').bind(id).run();

        // 11. Now delete the user
        await db.prepare('DELETE FROM USERS WHERE id = ?').bind(id).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete user error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
// PUT: Update user details
export async function PUT(
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

        const body = await req.json();
        const { initial_cost } = body;

        const db = await getDb();

        // Update initial_cost if provided
        if (initial_cost !== undefined) {
            await db.prepare('UPDATE USERS SET initial_cost = ? WHERE id = ?')
                .bind(initial_cost, id)
                .run();
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update user error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
