import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { clearCache } from '@/lib/response-cache';

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

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
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
// ?mode=clear_records — only delete trading/financial records, keep user account
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

        const { searchParams } = new URL(req.url);
        const mode = searchParams.get('mode'); // 'clear_records' or null

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Delete trading/financial records — each wrapped to avoid one failure blocking all
        const tradingDeletes = [
            { sql: 'DELETE FROM OPTIONS WHERE owner_id = ?', table: 'OPTIONS' },
            { sql: 'DELETE FROM STOCK_TRADES WHERE owner_id = ?', table: 'STOCK_TRADES' },
            { sql: 'DELETE FROM DAILY_NET_EQUITY WHERE user_id = ?', table: 'DAILY_NET_EQUITY' },
            { sql: 'DELETE FROM monthly_interest WHERE user_id = ?', table: 'monthly_interest' },
            { sql: 'DELETE FROM monthly_fees WHERE user_id = ?', table: 'monthly_fees' },
        ];

        for (const { sql, table } of tradingDeletes) {
            try {
                await db.prepare(sql).bind(id).run();
            } catch (e) {
                console.error(`Failed to delete from ${table}:`, e);
            }
        }

        // Strategy tables (cascade-aware order)
        try {
            await db.prepare('DELETE FROM STRATEGY_OPTIONS WHERE strategy_id IN (SELECT id FROM STRATEGIES WHERE owner_id = ?)').bind(id).run();
        } catch (e) { console.error('Failed to delete STRATEGY_OPTIONS:', e); }
        try {
            await db.prepare('DELETE FROM STRATEGY_STOCKS WHERE strategy_id IN (SELECT id FROM STRATEGIES WHERE owner_id = ?)').bind(id).run();
        } catch (e) { console.error('Failed to delete STRATEGY_STOCKS:', e); }
        try {
            await db.prepare('DELETE FROM STRATEGIES WHERE owner_id = ?').bind(id).run();
        } catch (e) { console.error('Failed to delete STRATEGIES:', e); }

        if (mode === 'clear_records') {
            // Also reset account initial values
            await db.prepare('UPDATE USERS SET initial_cost = 0, initial_cash = 0, initial_management_fee = 0, initial_deposit = 0 WHERE id = ?').bind(id).run();
            clearCache();
            return NextResponse.json({ success: true, mode: 'clear_records' });
        }

        // Full delete — also remove the user account and related non-trading data
        await db.prepare('DELETE FROM COMMENTS WHERE created_by = ? OR updated_by = ?').bind(id, id).run();
        await db.prepare('UPDATE ITEMS SET created_by = NULL WHERE created_by = ?').bind(id).run();
        await db.prepare('UPDATE ITEMS SET updated_by = NULL WHERE updated_by = ?').bind(id).run();
        await db.prepare('UPDATE ITEMS SET assignee_id = NULL WHERE assignee_id = ?').bind(id).run();
        await db.prepare('DELETE FROM PROJECTS WHERE user_id = ?').bind(id).run();
        await db.prepare('DELETE FROM PROJECT_USERS WHERE user_id = ?').bind(id).run();
        await db.prepare('DELETE FROM USERS WHERE id = ?').bind(id).run();

        clearCache();
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

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

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
