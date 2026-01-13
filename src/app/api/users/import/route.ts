import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';

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

interface ImportUser {
    user_id?: string | null;
    email: string;
    role: string;
    management_fee?: number | null;
    ib_account?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
}

// POST: Import users from JSON array
export async function POST(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const body = await req.json();
        const { users } = body;

        if (!Array.isArray(users)) {
            return NextResponse.json({ error: '無效的資料格式' }, { status: 400 });
        }

        const db = await getDb();
        const defaultPassword = '123456';
        const passwordHash = await bcrypt.hash(defaultPassword, 10);

        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const user of users as ImportUser[]) {
            try {
                // Validate required fields
                if (!user.email || !user.role) {
                    errors.push(`跳過：缺少必要欄位 (email 或 role)`);
                    skipped++;
                    continue;
                }

                // Check if user already exists (by email or user_id)
                const existing = await db.prepare(
                    `SELECT id FROM USERS WHERE email = ? OR (user_id IS NOT NULL AND user_id = ?)`
                ).bind(user.email, user.user_id || null).first();

                if (existing) {
                    errors.push(`跳過：使用者已存在 (${user.user_id || user.email})`);
                    skipped++;
                    continue;
                }

                // Insert new user with default password
                await db.prepare(
                    `INSERT INTO USERS (user_id, email, password, role, management_fee, ib_account, phone, avatar_url, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    user.user_id || null,
                    user.email,
                    passwordHash,
                    user.role,
                    user.management_fee || null,
                    user.ib_account || null,
                    user.phone || null,
                    user.avatar_url || null,
                    Date.now()
                ).run();

                imported++;
            } catch (error: any) {
                errors.push(`匯入失敗 (${user.user_id || user.email}): ${error.message}`);
                skipped++;
            }
        }

        return NextResponse.json({
            success: true,
            imported,
            skipped,
            total: users.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
