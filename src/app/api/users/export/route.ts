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

        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');

        const db = await getDb();

        let query = `SELECT id, user_id, email, role, management_fee, ib_account, phone, avatar_url, initial_cost 
             FROM USERS 
             WHERE email != 'admin'`;

        const params: any[] = [];

        if (year && year !== 'All') {
            query += ` AND year = ?`;
            params.push(parseInt(year));
        }

        query += ` ORDER BY id ASC`;

        const result = await db.prepare(query).bind(...params).all();

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
