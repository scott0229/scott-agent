
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // 1. Get sample December data
        const query = `
            SELECT 
                id,
                owner_id,
                date(open_date, 'unixepoch') as open_date_str,
                collateral, 
                days_held,
                type,
                strftime('%Y', datetime(open_date, 'unixepoch')) as year
            FROM OPTIONS 
            WHERE strftime('%m', datetime(open_date, 'unixepoch')) = '12'
            ORDER BY open_date DESC
            LIMIT 5;
        `;

        const { results } = await db.prepare(query).all();

        // 2. Check counts of null/zero days_held
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN days_held IS NULL THEN 1 END) as null_days,
                COUNT(CASE WHEN days_held = 0 THEN 1 END) as zero_days,
                COUNT(CASE WHEN collateral IS NULL THEN 1 END) as null_collateral,
                COUNT(CASE WHEN collateral = 0 THEN 1 END) as zero_collateral
            FROM OPTIONS
            WHERE strftime('%m', datetime(open_date, 'unixepoch')) = '12';
        `;

        const { results: stats } = await db.prepare(statsQuery).all();

        return NextResponse.json({
            sample: results,
            stats: stats[0]
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
