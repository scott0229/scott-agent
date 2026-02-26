import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        // Expecting { records: [...], year: 2025 } or just Array (legacy)
        const records = Array.isArray(body) ? body : body.records;
        const globalYear = !Array.isArray(body) ? body.year : undefined; // Environment year

        if (!Array.isArray(records) || records.length === 0) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const stmt = db.prepare(`
            INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, interest, year, updated_at)
            VALUES (?, ?, ?, ?, ?, unixepoch())
            ON CONFLICT(user_id, date) DO UPDATE SET
            net_equity = excluded.net_equity,
            interest = excluded.interest,
            year = excluded.year,
            updated_at = unixepoch()
        `);

        // Batch execution
        const batch = [];
        for (const r of records) {
            // Validate
            if (!r.user_id || !r.date || r.net_equity === undefined) continue;

            // Normalize date (if string YYYY-MM-DD -> timestamp)
            let timestamp = r.date;
            if (typeof r.date === 'string') {
                const d = new Date(r.date);
                timestamp = d.getTime() / 1000;
            }

            // Determine year: 
            // 1. Logic enforcement: If globalYear (Environment Year) is set, USE IT.
            // 2. Otherwise use record-level year if provided.
            // 3. Fallback to deriving from date.

            let year = globalYear; // Priority 1

            if (!year) {
                year = r.year; // Priority 2
            }

            if (!year) {
                const d = new Date(timestamp * 1000);
                year = d.getUTCFullYear(); // Priority 3
            }

            const interest = r.interest !== undefined ? r.interest : 0;
            batch.push(stmt.bind(r.user_id, timestamp, r.net_equity, interest, year));
        }

        if (batch.length > 0) {
            await db.batch(batch);
        }

        return NextResponse.json({ success: true, count: batch.length });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
