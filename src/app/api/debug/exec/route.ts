import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

export async function POST(req: NextRequest) {
    try {
        const { sql, params } = await req.json();
        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        if (!sql) {
            return NextResponse.json({ error: 'SQL is required' }, { status: 400 });
        }

        const result = await db.prepare(sql).bind(...(params || [])).all();
        return NextResponse.json({ result });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
