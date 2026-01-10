import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(req: NextRequest) {
    try {
        const { sql, params } = await req.json();
        const db = await getDb();

        if (!sql) {
            return NextResponse.json({ error: 'SQL is required' }, { status: 400 });
        }

        const result = await db.prepare(sql).bind(...(params || [])).all();
        return NextResponse.json({ result });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
