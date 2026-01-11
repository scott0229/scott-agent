import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken, hashPassword } from '@/lib/auth';

// Helper to check for admin role
async function checkAdmin(req: NextRequest) {
    const token = req.cookies.get('token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
        return null;
    }
    return payload;
}

export const dynamic = 'force-dynamic'; // Ensure no caching

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const mode = searchParams.get('mode');
        console.log('API Users GET:', { url: req.url, mode, roles: searchParams.get('roles') }); // Debug log

        if (mode === 'selection') {
            const token = req.cookies.get('token')?.value;
            console.log('API Users: Token present?', !!token);
            if (!token) {
                console.log('API Users: No token found in cookies');
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            const payload = await verifyToken(token);
            console.log('API Users: Token verification result:', !!payload);
            if (!payload) {
                return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
            }

            const db = await getDb();

            const roles = searchParams.get('roles')?.split(',');
            const year = searchParams.get('year');

            let query = 'SELECT id, email, user_id, avatar_url, ib_account FROM USERS';
            const params: any[] = [];
            let whereAdded = false;

            // Add year filter (except for admin/trader)
            if (year && year !== 'All') {
                query += ' WHERE (year = ? OR role IN (\'admin\', \'trader\'))';
                params.push(parseInt(year));
                whereAdded = true;
            }

            if (roles && roles.length > 0) {
                const placeholders = roles.map(() => '?').join(',');
                query += whereAdded ? ` AND role IN (${placeholders})` : ` WHERE role IN (${placeholders})`;
                params.push(...roles);
                whereAdded = true;
            }

            const userId = searchParams.get('userId');
            if (userId) {
                query += whereAdded ? ' AND user_id = ?' : ' WHERE user_id = ?';
                params.push(userId);
            }

            query += ' ORDER BY email ASC';

            // Return simplified user list for dropdowns
            console.log('Executing query:', query, params); // Check SQL construction
            const { results } = await db.prepare(query).bind(...params).all();
            return NextResponse.json({ users: results });
        }

        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const db = await getDb();
        const year = searchParams.get('year');

        let query = `
            SELECT id, email, user_id, role, management_fee, ib_account, phone, created_at 
            FROM USERS 
        `;
        const params: any[] = [];

        // Add year filter (except for admin/trader)
        if (year && year !== 'All') {
            query += ' WHERE (year = ? OR role IN (\'admin\', \'trader\'))';
            params.push(parseInt(year));
        }

        query += `
            ORDER BY 
                CASE 
                    WHEN role = 'admin' THEN 1 
                    WHEN role = 'trader' THEN 2 
                    WHEN role = 'customer' THEN 3 
                    ELSE 4 
                END ASC,
                created_at DESC
        `;

        const { results } = await db.prepare(query).bind(...params).all();

        return NextResponse.json({ users: results });
    } catch (error) {
        console.error('Fetch users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { email, userId, password, role, managementFee, ibAccount, phone, year } = await req.json() as {
            email?: string;
            userId?: string;
            password?: string;
            role?: string;
            managementFee?: number;
            ibAccount?: string;
            phone?: string;
            year?: number;
        };

        if (!email || !userId || !password || !role) {
            return NextResponse.json({ error: '請填寫所有欄位' }, { status: 400 });
        }

        if (!['admin', 'trader', 'customer'].includes(role)) {
            return NextResponse.json({ error: '無效的角色' }, { status: 400 });
        }

        const db = await getDb();

        // Check existing email or user_id
        const existing = await db.prepare('SELECT * FROM USERS WHERE email = ? OR user_id = ?').bind(email, userId).first();
        if (existing) {
            if (existing.email === email) {
                return NextResponse.json({ error: '此 Email 已被註冊' }, { status: 409 });
            }
            if (existing.user_id === userId) {
                return NextResponse.json({ error: '此 User ID 已被使用' }, { status: 409 });
            }
        }

        const hashedPassword = await hashPassword(password);
        const fee = role === 'customer' ? (managementFee || 0) : 0;
        const ib = role === 'customer' ? (ibAccount || '') : '';
        const userYear = year || new Date().getFullYear();

        await db.prepare('INSERT INTO USERS (email, user_id, password, role, management_fee, ib_account, phone, year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())')
            .bind(email, userId, hashedPassword, role, fee, ib, phone || null, userYear)
            .run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Create user error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: '缺少使用者 ID' }, { status: 400 });
        }

        // Prevent deleting self
        if (Number(id) === admin.id) {
            return NextResponse.json({ error: '不能刪除自己' }, { status: 400 });
        }

        const db = await getDb();
        await db.prepare('DELETE FROM USERS WHERE id = ?').bind(id).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete user error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { id, email, userId, password, role, managementFee, ibAccount, phone } = await req.json() as {
            id: number;
            email?: string;
            userId?: string;
            password?: string;
            role?: string;
            managementFee?: number;
            ibAccount?: string;
            phone?: string;
        };

        if (!id) {
            return NextResponse.json({ error: '缺少使用者 ID' }, { status: 400 });
        }

        const db = await getDb();

        // Get current user to check if exists
        const currentUser = await db.prepare('SELECT * FROM USERS WHERE id = ?').bind(id).first();
        if (!currentUser) {
            return NextResponse.json({ error: '使用者不存在' }, { status: 404 });
        }

        // Validate Role
        if (role && !['admin', 'trader', 'customer'].includes(role)) {
            return NextResponse.json({ error: '無效的角色' }, { status: 400 });
        }

        // Check for duplicates if email/userId changed
        if ((email && email !== currentUser.email) || (userId && userId !== currentUser.user_id)) {
            const existing = await db.prepare('SELECT * FROM USERS WHERE (email = ? OR user_id = ?) AND id != ?')
                .bind(email || currentUser.email, userId || currentUser.user_id, id)
                .first();

            if (existing) {
                if (existing.email === email) return NextResponse.json({ error: 'Email 已被使用' }, { status: 409 });
                if (existing.user_id === userId) return NextResponse.json({ error: 'User ID 已被使用' }, { status: 409 });
            }
        }

        let updateQuery = 'UPDATE USERS SET updated_at = unixepoch()';
        const params: any[] = [];

        if (email) {
            updateQuery += ', email = ?';
            params.push(email);
        }
        if (userId) {
            updateQuery += ', user_id = ?';
            params.push(userId);
        }
        if (role) {
            updateQuery += ', role = ?';
            params.push(role);
        }

        if (typeof managementFee !== 'undefined') {
            updateQuery += ', management_fee = ?';
            params.push(managementFee);
        } else if (role && role !== 'customer') {
            updateQuery += ', management_fee = 0';
        }

        if (ibAccount !== undefined) {
            updateQuery += ', ib_account = ?';
            params.push(ibAccount);
        } else if (role && role !== 'customer') {
            updateQuery += ', ib_account = ""';
        }

        if (typeof phone !== 'undefined') {
            updateQuery += ', phone = ?';
            params.push(phone);
        }

        if (password && password.trim() !== '') {
            const hashedPassword = await hashPassword(password);
            updateQuery += ', password = ?';
            params.push(hashedPassword);
        }

        updateQuery += ' WHERE id = ?';
        params.push(id);

        await db.prepare(updateQuery).bind(...params).run();

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Update user error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
