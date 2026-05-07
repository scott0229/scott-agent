import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const payload = await verifyToken(req.cookies.get('token')?.value || '');
        if (!payload || !['admin', 'manager', 'customer'].includes(payload.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const yearStr = searchParams.get('year');

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        let usersQuery = `SELECT id FROM USERS WHERE email != 'admin'`;
        const usersParams: any[] = [];
        
        if (yearStr && yearStr !== 'All') {
            usersQuery += ` AND year = ?`;
            usersParams.push(parseInt(yearStr));
        }
        
        if (payload.role === 'customer') {
            usersQuery += ` AND id = ?`;
            usersParams.push(payload.userId);
        }

        const { results: users } = await db.prepare(usersQuery).bind(...usersParams).all();
        if (!users || users.length === 0) {
            return NextResponse.json({ latestDate: null });
        }

        const userIds = users.map((u: any) => u.id);

        const latestQuery = `
            SELECT MAX(d) as latestDate FROM (
                SELECT date(datetime(open_date, 'unixepoch')) as d FROM STOCK_TRADES WHERE owner_id IN (${userIds.join(',')}) AND open_date IS NOT NULL
                UNION
                SELECT date(datetime(close_date, 'unixepoch')) as d FROM STOCK_TRADES WHERE owner_id IN (${userIds.join(',')}) AND close_date IS NOT NULL
                UNION
                SELECT date(datetime(open_date, 'unixepoch')) as d FROM OPTIONS WHERE owner_id IN (${userIds.join(',')}) AND open_date IS NOT NULL
                UNION
                SELECT date(datetime(settlement_date, 'unixepoch')) as d FROM OPTIONS WHERE owner_id IN (${userIds.join(',')}) AND settlement_date IS NOT NULL
            )
        `;

        const { results } = await db.prepare(latestQuery).all();
        const latestDate = results?.[0]?.latestDate || null;

        return NextResponse.json({ latestDate });
    } catch (error: any) {
        console.error('Failed to fetch latest date:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
