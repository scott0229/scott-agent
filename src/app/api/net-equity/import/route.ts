import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        // Expecting { records: [{ user_id, date, net_equity }] } or Array
        // Let's support an array directly or wrapper
        const records = Array.isArray(body) ? body : body.records;

        if (!Array.isArray(records) || records.length === 0) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        const db = await getDb();
        const stmt = db.prepare(`
            INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, updated_at)
            VALUES (?, ?, ?, unixepoch())
            ON CONFLICT(user_id, date) DO UPDATE SET
            net_equity = excluded.net_equity,
            updated_at = unixepoch()
        `);

        // Batch execution
        const batch = [];
        for (const r of records) {
            // Validate
            if (!r.user_id || !r.date || r.net_equity === undefined) continue;

            // Normailize date (if string YYYY-MM-DD -> timestamp)
            let timestamp = r.date;
            if (typeof r.date === 'string') {
                const d = new Date(r.date);
                timestamp = d.getTime() / 1000;
            }

            batch.push(stmt.bind(r.user_id, timestamp, r.net_equity));
        }

        if (batch.length > 0) {
            await db.batch(batch);
        }

        return NextResponse.json({ success: true, count: batch.length });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
