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

// GET: Export all users (except admin) as JSON
export async function GET(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const db = await getDb();

        // Get all users except admin account
        const result = await db.prepare(
            `SELECT id, user_id, email, role, management_fee, ib_account, phone, avatar_url 
             FROM USERS 
             WHERE email != 'admin' 
             ORDER BY id ASC`
        ).all();

        const users = result.results || [];

        return NextResponse.json({
            users,
            exportDate: new Date().toISOString(),
            count: users.length
        });
    } catch (error) {
        console.error('Export users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
