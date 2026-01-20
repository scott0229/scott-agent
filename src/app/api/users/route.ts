import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { cacheResponse, clearCache } from '@/lib/response-cache';
import { getCachedUserSelection } from '@/lib/user-cache';

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

            // Wrap expensive query in cache
            const responseData = await getCachedUserSelection(req, async () => {
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
                        (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.year = ? AND OPTIONS.status = '未平倉') as open_count,
                        (SELECT COALESCE(SUM(deposit), 0) 
                         FROM DAILY_NET_EQUITY WHERE user_id = USERS.id AND year = ?) as net_deposit,
                        (SELECT COUNT(*) FROM DAILY_NET_EQUITY WHERE user_id = USERS.id AND year = ? AND deposit != 0) as deposits_count,
                        (SELECT COUNT(*) FROM monthly_interest WHERE monthly_interest.user_id = USERS.id AND monthly_interest.year = ?) as interest_count,
                        (SELECT COALESCE(SUM(collateral), 0) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.year = ? AND OPTIONS.status = '未平倉' AND OPTIONS.type = 'PUT') as open_put_covered_capital
                        FROM USERS`;

                    // Broaden filter: Include users who belong to the year OR are admin OR have activity in that year
                    query += ` WHERE year = ?`;

                    params.push(parseInt(year)); // For options_count subquery
                    params.push(parseInt(year)); // For open_count subquery
                    params.push(parseInt(year)); // For net_deposit subquery
                    params.push(parseInt(year)); // For deposits_count subquery
                    params.push(parseInt(year)); // For interest_count subquery
                    params.push(parseInt(year)); // For open_put_covered_capital subquery

                    params.push(parseInt(year)); // For main WHERE year = ?

                    whereAdded = true;
                } else {
                    query = `SELECT id, email, user_id, avatar_url, ib_account, role, initial_cost, 
                        (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id) as options_count,
                        (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.status = '未平倉') as open_count,
                        (SELECT COALESCE(SUM(deposit), 0) 
                         FROM DAILY_NET_EQUITY WHERE user_id = USERS.id) as net_deposit,
                        (SELECT COUNT(*) FROM DAILY_NET_EQUITY WHERE user_id = USERS.id AND deposit != 0) as deposits_count,
                        (SELECT COUNT(*) FROM monthly_interest WHERE monthly_interest.user_id = USERS.id) as interest_count,
                        (SELECT COALESCE(SUM(collateral), 0) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.status = '未平倉' AND OPTIONS.type = 'PUT') as open_put_covered_capital
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
                        SUM(COALESCE(final_profit, 0)) as profit,
                        SUM(
                            (strike_price * ABS(quantity) * 100) * 
                            (
                                (
                                    CASE 
                                        WHEN settlement_date IS NOT NULL THEN settlement_date 
                                        WHEN to_date IS NOT NULL THEN to_date
                                        ELSE unixepoch() 
                                    END - open_date
                                ) / 86400.0
                            )
                        ) as turnover
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
                            userStats[row.month] = { total: 0, put: 0, call: 0, interest: 0, turnover: 0 };
                        }

                        userStats[row.month].total += row.profit;
                        userStats[row.month].turnover += (row.turnover || 0);
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
                            userStats[monthStr] = { total: 0, put: 0, call: 0, interest: 0, turnover: 0 };
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
                            const monthData = userMonthlyData?.[monthStr] || { total: 0, put: 0, call: 0, interest: 0, turnover: 0 };
                            allMonths.push({
                                month: monthStr,
                                total_profit: monthData.total,
                                put_profit: monthData.put,
                                call_profit: monthData.call,
                                interest: monthData.interest,
                                turnover: monthData.turnover
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

                // Calculate Market Data Count
                let marketDataCount = 0;
                if (year && year !== 'All') {
                    const startOfYear = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
                    const endOfYear = Math.floor(new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000);
                    // Align with export logic: include 20 days buffer before start of year
                    const bufferSeconds = 20 * 86400;
                    const startFilter = startOfYear - bufferSeconds;

                    const countResult = await db.prepare('SELECT COUNT(*) as count FROM market_prices WHERE date >= ? AND date <= ?')
                        .bind(startFilter, endOfYear)
                        .first();
                    marketDataCount = countResult?.count || 0;

                    return {
                        users,
                        meta: {
                            marketDataCount
                        }
                    };
                } else {
                    const countResult = await db.prepare('SELECT COUNT(*) as count FROM market_prices').first();
                    marketDataCount = countResult?.count || 0;
                }

                return { users, meta: { marketDataCount } };
            });

            return NextResponse.json(responseData);
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

        const params: any[] = [];
        let additionalSelects = '';

        if (year && year !== 'All') {
            // Add counts and net_deposit for specific year
            additionalSelects = `, 
                (SELECT COALESCE(SUM(deposit), 0) FROM DAILY_NET_EQUITY WHERE user_id = USERS.id AND year = ?) as net_deposit,
                (SELECT COUNT(*) FROM DAILY_NET_EQUITY WHERE user_id = USERS.id AND year = ? AND deposit != 0) as deposits_count,
                (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.year = ?) as options_count,
                (SELECT COUNT(*) FROM monthly_interest WHERE monthly_interest.user_id = USERS.id AND monthly_interest.year = ?) as interest_count,
                (SELECT net_equity FROM DAILY_NET_EQUITY WHERE user_id = USERS.id ORDER BY date DESC LIMIT 1) as current_net_equity`;

            // Params for SELECT subqueries
            params.push(parseInt(year)); // net_deposit
            params.push(parseInt(year)); // deposits_count
            params.push(parseInt(year)); // options_count
            params.push(parseInt(year)); // interest_count
        } else {
            // General counts for All years
            additionalSelects = `, 
                (SELECT COALESCE(SUM(deposit), 0) FROM DAILY_NET_EQUITY WHERE user_id = USERS.id) as net_deposit,
                (SELECT COUNT(*) FROM DAILY_NET_EQUITY WHERE user_id = USERS.id AND deposit != 0) as deposits_count,
                (SELECT COUNT(*) FROM OPTIONS WHERE OPTIONS.owner_id = USERS.id) as options_count,
                (SELECT COUNT(*) FROM monthly_interest WHERE monthly_interest.user_id = USERS.id) as interest_count,
                (SELECT net_equity FROM DAILY_NET_EQUITY WHERE user_id = USERS.id ORDER BY date DESC LIMIT 1) as current_net_equity`;
        }

        let query = `
            SELECT id, email, user_id, role, management_fee, ib_account, phone, created_at, initial_cost${additionalSelects}
            FROM USERS 
        `;
        let whereClauses = [];

        // If customer, restrict to self
        if (userPayload.role === 'customer') {
            whereClauses.push('id = ?');
            params.push(userPayload.id);
        }

        if (year && year !== 'All') {
            whereClauses.push('year = ?');
            params.push(parseInt(year)); // year = ?
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
                user_id ASC
        `;

        const { results } = await db.prepare(query).bind(...params).all();

        // Calculate total_profit for each user if year is specified
        if (year && year !== 'All') {
            const statsQuery = `
                SELECT 
                    owner_id as user_id,
                    strftime('%m', datetime(open_date, 'unixepoch')) as month,
                    SUM(COALESCE(final_profit, 0)) as profit
                FROM OPTIONS
                WHERE strftime('%Y', datetime(open_date, 'unixepoch')) = ?
                GROUP BY owner_id, month
            `;
            const { results: optionsResults } = await db.prepare(statsQuery).bind(year).all();

            const interestQuery = `SELECT user_id, month, interest FROM monthly_interest WHERE year = ?`;
            const { results: interestResults } = await db.prepare(interestQuery).bind(parseInt(year)).all();

            const userProfitMap = new Map<number, number>();

            (optionsResults as any[]).forEach(row => {
                const current = userProfitMap.get(row.user_id) || 0;
                userProfitMap.set(row.user_id, current + row.profit);
            });

            (interestResults as any[]).forEach(row => {
                const current = userProfitMap.get(row.user_id) || 0;
                userProfitMap.set(row.user_id, current + row.interest);
            });

            (results as any[]).forEach((user: any) => {
                user.total_profit = userProfitMap.get(user.id) || 0;
            });
        }

        // Calculate Market Data Count
        let marketDataCount = 0;
        if (year && year !== 'All') {
            const startOfYear = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
            const endOfYear = Math.floor(new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000);
            const bufferSeconds = 20 * 86400;
            const startFilter = startOfYear - bufferSeconds;

            const countResult = await db.prepare('SELECT COUNT(*) as count FROM market_prices WHERE date >= ? AND date <= ?')
                .bind(startFilter, endOfYear)
                .first();
            marketDataCount = countResult?.count || 0;
        } else {
            const countResult = await db.prepare('SELECT COUNT(*) as count FROM market_prices').first();
            marketDataCount = countResult?.count || 0;
        }

        return NextResponse.json({ users: results, meta: { marketDataCount } });
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
        const mode = searchParams.get('mode');

        const db = await getDb();

        if (mode === 'all') {
            const year = searchParams.get('year');
            if (!year || year === 'All') {
                return NextResponse.json({ error: '請指定要刪除的年份' }, { status: 400 });
            }

            // Count users first to give accurate report (excluding admin)
            const { count } = await db.prepare('SELECT count(*) as count FROM USERS WHERE year = ? AND id != ?')
                .bind(parseInt(year), admin.id)
                .first();

            // Get user IDs that will be deleted
            const { results: usersToDelete } = await db.prepare('SELECT id FROM USERS WHERE year = ? AND id != ?')
                .bind(parseInt(year), admin.id)
                .all();

            const userIds = (usersToDelete as any[]).map((u: any) => u.id);

            if (userIds.length > 0) {
                const placeholders = userIds.map(() => '?').join(',');

                // 1. Delete all OPTIONS for these users
                await db.prepare(`DELETE FROM OPTIONS WHERE owner_id IN (${placeholders})`).bind(...userIds).run();

                // 2. DEPOSITS table dropped, data moved to DAILY_NET_EQUITY

                // 3. Delete all monthly_interest for these users
                await db.prepare(`DELETE FROM monthly_interest WHERE user_id IN (${placeholders})`).bind(...userIds).run();

                // 4. Delete all DAILY_NET_EQUITY for these users
                await db.prepare(`DELETE FROM DAILY_NET_EQUITY WHERE user_id IN (${placeholders})`).bind(...userIds).run();

                // 5. Delete all COMMENTS created/updated by these users
                await db.prepare(`DELETE FROM COMMENTS WHERE created_by IN (${placeholders}) OR updated_by IN (${placeholders})`).bind(...userIds, ...userIds).run();

                // 6. DEPOSITS table dropped

                // 7. Set created_by/updated_by to NULL for items created/updated by these users
                await db.prepare(`UPDATE ITEMS SET created_by = NULL WHERE created_by IN (${placeholders})`).bind(...userIds).run();
                await db.prepare(`UPDATE ITEMS SET updated_by = NULL WHERE updated_by IN (${placeholders})`).bind(...userIds).run();

                // 8. Unassign ITEMS assigned to these users
                await db.prepare(`UPDATE ITEMS SET assignee_id = NULL WHERE assignee_id IN (${placeholders})`).bind(...userIds).run();

                // 9. Delete all PROJECTS for these users
                await db.prepare(`DELETE FROM PROJECTS WHERE user_id IN (${placeholders})`).bind(...userIds).run();

                // 10. Delete all PROJECT_USERS for these users
                await db.prepare(`DELETE FROM PROJECT_USERS WHERE user_id IN (${placeholders})`).bind(...userIds).run();

                // 11. Now delete all users in that year except the current admin (self)
                await db.prepare('DELETE FROM USERS WHERE year = ? AND id != ?')
                    .bind(parseInt(year), admin.id)
                    .run();
            }

            return NextResponse.json({ success: true, count: count });
        }

        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: '缺少使用者 ID' }, { status: 400 });
        }

        // Prevent deleting self
        if (Number(id) === admin.id) {
            return NextResponse.json({ error: '不能刪除自己' }, { status: 400 });
        }

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
