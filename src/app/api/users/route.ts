import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken, hashPassword } from '@/lib/auth';

// Helper to check for admin, manager, or trader role
async function checkAdmin(req: NextRequest) {
    const token = req.cookies.get('token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || !['admin', 'manager', 'trader'].includes(payload.role)) {
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

            let query = '';
            const params: any[] = [];
            let whereAdded = false;

            // Add year filter (only admin crosses years)
            if (year && year !== 'All') {
                query = `SELECT id, email, user_id, avatar_url, ib_account, role, initial_cost, 
                        (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.year = ?) as options_count,
                        (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.year = ? AND OPTIONS.status = '未平倉') as open_count
                        FROM USERS`;
                query += ' WHERE (year = ? OR role = \'admin\')';
                params.push(parseInt(year)); // For options_count subquery
                params.push(parseInt(year)); // For open_count subquery
                params.push(parseInt(year)); // For main query
                whereAdded = true;
            } else {
                query = `SELECT id, email, user_id, avatar_url, ib_account, role, initial_cost, 
                        (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id) as options_count,
                        (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.status = '未平倉') as open_count
                        FROM USERS`;
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
            const { results: users } = await db.prepare(query).bind(...params).all();

            // Get monthly statistics for each user if year is specified
            if (year && year !== 'All') {
                const statsQuery = `
                    SELECT 
                        owner_id as user_id,
                        strftime('%m', datetime(open_date, 'unixepoch')) as month,
                        type,
                        SUM(COALESCE(final_profit, 0)) as profit
                    FROM OPTIONS
                    WHERE strftime('%Y', datetime(open_date, 'unixepoch')) = ?
                    GROUP BY owner_id, month, type
                `;

                const { results: statsResults } = await db.prepare(statsQuery).bind(year).all();

                // Fetch interest data for the year
                const interestQuery = `
                    SELECT 
                        user_id,
                        month,
                        interest
                    FROM monthly_interest
                    WHERE year = ?
                `;
                const { results: interestResults } = await db.prepare(interestQuery).bind(parseInt(year)).all();

                // Aggregate statistics by user
                const userStatsMap = new Map();

                (statsResults as any[]).forEach((row: any) => {
                    if (!userStatsMap.has(row.user_id)) {
                        userStatsMap.set(row.user_id, {});
                    }

                    const userStats = userStatsMap.get(row.user_id);
                    if (!userStats[row.month]) {
                        userStats[row.month] = { total: 0, put: 0, call: 0, interest: 0 };
                    }

                    userStats[row.month].total += row.profit;
                    if (row.type === 'PUT') {
                        userStats[row.month].put += row.profit;
                    } else if (row.type === 'CALL') {
                        userStats[row.month].call += row.profit;
                    }
                });

                // Add interest data to userStatsMap
                (interestResults as any[]).forEach((row: any) => {
                    if (!userStatsMap.has(row.user_id)) {
                        userStatsMap.set(row.user_id, {});
                    }
                    const userStats = userStatsMap.get(row.user_id);
                    const monthStr = row.month.toString().padStart(2, '0');
                    if (!userStats[monthStr]) {
                        userStats[monthStr] = { total: 0, put: 0, call: 0, interest: 0 };
                    }
                    userStats[monthStr].interest = row.interest;
                    userStats[monthStr].total += row.interest; // Add interest to total
                });

                // Attach monthly_stats to each user
                (users as any[]).forEach((user: any) => {
                    const userMonthlyData = userStatsMap.get(user.id);

                    // Create all 12 months with default zero values
                    const allMonths = [];
                    for (let i = 1; i <= 12; i++) {
                        const monthStr = i.toString().padStart(2, '0');
                        const monthData = userMonthlyData?.[monthStr] || { total: 0, put: 0, call: 0, interest: 0 };
                        allMonths.push({
                            month: monthStr,
                            total_profit: monthData.total,
                            put_profit: monthData.put,
                            call_profit: monthData.call,
                            interest: monthData.interest
                        });
                    }

                    user.monthly_stats = allMonths;

                    // Calculate total profit (including interest)
                    user.total_profit = allMonths.reduce(
                        (sum: number, stat: any) => sum + stat.total_profit,
                        0
                    );
                });
            }

            return NextResponse.json({ users });
        }

        const admin = await checkAdmin(req);

        // If not admin/manager/trader/admin-like, check if it is a customer
        // We need to verify token again if checkAdmin failed or returned null (it returns payload)
        // Actually checkAdmin verifies token and checks for admin/manager/trader.
        // If it returns null, it might be a customer or invalid.

        let userPayload = admin;
        if (!userPayload) {
            // Check if it's a customer
            const token = req.cookies.get('token')?.value;
            if (token) {
                const payload = await verifyToken(token);
                if (payload && payload.role === 'customer') {
                    userPayload = payload;
                }
            }
        }

        if (!userPayload) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const db = await getDb();
        const year = searchParams.get('year');

        let query = `
            SELECT id, email, user_id, role, management_fee, ib_account, phone, created_at, initial_cost 
            FROM USERS 
        `;
        const params: any[] = [];
        let whereClauses = [];

        // If customer, restrict to self
        if (userPayload.role === 'customer') {
            whereClauses.push('id = ?');
            params.push(userPayload.id);
        }

        // Add year filter (only admin crosses years, but if customer is restricted to self, does year matter?
        // User table has 'year' column? Yes.
        // If customer wants to see their account for a specific year?
        // The user request is "Unable to see other users".
        // Usually User Management shows the user account records.
        // If the user table has a 'year' column, it means user records are year-specific?
        // Yes, existing code: "SELECT ... WHERE (year = ? OR role = 'admin')"
        if (year && year !== 'All') {
            whereClauses.push(`(year = ? OR role = 'admin')`);
            params.push(parseInt(year));
        }

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += `
            ORDER BY 
                CASE 
                    WHEN role = 'admin' THEN 1 
                    WHEN role = 'manager' THEN 2 
                    WHEN role = 'trader' THEN 3 
                    WHEN role = 'customer' THEN 4 
                    ELSE 5 
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
        if (!admin || admin.role === 'trader') {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { email, userId, password, role, managementFee, ibAccount, phone, year, initialCost } = await req.json() as {
            email?: string;
            userId?: string;
            password?: string;
            role?: string;
            managementFee?: number;
            ibAccount?: string;
            phone?: string;
            year?: number;
            initialCost?: number;
        };

        if (!email || !userId || !password || !role) {
            return NextResponse.json({ error: '請填寫所有欄位' }, { status: 400 });
        }

        if (!['admin', 'manager', 'trader', 'customer'].includes(role)) {
            return NextResponse.json({ error: '無效的角色' }, { status: 400 });
        }

        const db = await getDb();

        const userYear = year || new Date().getFullYear();

        // Check existing email or user_id in the same year
        const existing = await db.prepare('SELECT * FROM USERS WHERE (email = ? OR user_id = ?) AND year = ?')
            .bind(email, userId, userYear)
            .first();
        if (existing) {
            if (existing.email === email) {
                return NextResponse.json({ error: '此 Email 已在該年度被註冊' }, { status: 409 });
            }
            if (existing.user_id === userId) {
                return NextResponse.json({ error: '此 User ID 已在該年度被使用' }, { status: 409 });
            }
        }

        const hashedPassword = await hashPassword(password);
        const fee = role === 'customer' ? (managementFee || 0) : 0;
        const ib = role === 'customer' ? (ibAccount || '') : '';
        const initCost = role === 'customer' ? (initialCost || 0) : 0;
        // userYear is already defined above

        await db.prepare('INSERT INTO USERS (email, user_id, password, role, management_fee, ib_account, phone, year, initial_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())')
            .bind(email, userId, hashedPassword, role, fee, ib, phone || null, userYear, initCost)
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
        if (!admin || admin.role === 'trader') {
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
        if (!admin || admin.role === 'trader') {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { id, email, userId, password, role, managementFee, ibAccount, phone, initialCost } = await req.json() as {
            id: number;
            email?: string;
            userId?: string;
            password?: string;
            role?: string;
            managementFee?: number;
            ibAccount?: string;
            phone?: string;
            initialCost?: number;
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
        if (role && !['admin', 'manager', 'trader', 'customer'].includes(role)) {
            return NextResponse.json({ error: '無效的角色' }, { status: 400 });
        }

        // Check for duplicates if email/userId changed
        if ((email && email !== currentUser.email) || (userId && userId !== currentUser.user_id)) {
            // Check only within the same year
            const existing = await db.prepare('SELECT * FROM USERS WHERE (email = ? OR user_id = ?) AND year = ? AND id != ?')
                .bind(email || currentUser.email, userId || currentUser.user_id, currentUser.year, id)
                .first();

            if (existing) {
                if (existing.email === email) return NextResponse.json({ error: 'Email 已在該年度被使用' }, { status: 409 });
                if (existing.user_id === userId) return NextResponse.json({ error: 'User ID 已在該年度被使用' }, { status: 409 });
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

        if (typeof initialCost !== 'undefined') {
            updateQuery += ', initial_cost = ?';
            params.push(initialCost);
        } else if (role && role !== 'customer') {
            updateQuery += ', initial_cost = 0';
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
