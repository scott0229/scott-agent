import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// Helper to check for admin or manager role
export const dynamic = 'force-dynamic';

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

        let query = `SELECT id, user_id, email, role, management_fee, ib_account, phone, avatar_url, initial_cost, year
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

        // Fetch deposits for each user
        for (const user of users) {
            let depositQuery = `
                SELECT 
                    d.*,
                    u.user_id as depositor_user_id,
                    u.email as depositor_email
                FROM DEPOSITS d
                LEFT JOIN USERS u ON d.user_id = u.id
                WHERE d.user_id = ?
            `;
            const depositParams: any[] = [user.id];

            if (year && year !== 'All') {
                depositQuery += ` AND d.year = ?`;
                depositParams.push(parseInt(year));
            }

            depositQuery += ` ORDER BY d.deposit_date DESC`;

            const { results: deposits } = await db.prepare(depositQuery).bind(...depositParams).all();
            (user as any).deposits = deposits || [];

            // Fetch net equity records for each user
            let netEquityQuery = `
                SELECT date, net_equity, year
                FROM DAILY_NET_EQUITY
                WHERE user_id = ?
            `;
            const netEquityParams: any[] = [user.id];

            if (year && year !== 'All') {
                netEquityQuery += ` AND year = ?`;
                netEquityParams.push(parseInt(year));
            }

            netEquityQuery += ` ORDER BY date DESC`;

            const { results: netEquityRecords } = await db.prepare(netEquityQuery).bind(...netEquityParams).all();
            (user as any).net_equity_records = netEquityRecords || [];

            // Fetch options trading records for each user
            let optionsQuery = `
                SELECT *
                FROM OPTIONS
                WHERE owner_id = ?
            `;
            const optionsParams: any[] = [user.id];

            if (year && year !== 'All') {
                optionsQuery += ` AND year = ?`;
                optionsParams.push(parseInt(year));
            }

            optionsQuery += ` ORDER BY open_date DESC`;

            const { results: options } = await db.prepare(optionsQuery).bind(...optionsParams).all();
            (user as any).options = options || [];
        }

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
