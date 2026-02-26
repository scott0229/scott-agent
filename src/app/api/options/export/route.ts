import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// GET: Export options for a specific owner
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: '權限不足' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const ownerId = searchParams.get('ownerId');
        const year = searchParams.get('year');

        if (!ownerId) {
            return NextResponse.json({ error: '缺少 ownerId 參數' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Build query with year filter if provided
        let query = 'SELECT * FROM OPTIONS WHERE owner_id = ?';
        const params: any[] = [ownerId];

        if (year && year !== 'All') {
            query += ' AND year = ?';
            params.push(parseInt(year));
        }

        query += ' ORDER BY open_date DESC';

        const result = await db.prepare(query).bind(...params).all();
        const options = result.results || [];

        return NextResponse.json({
            options,
            exportDate: new Date().toISOString(),
            count: options.length,
            ownerId,
            year: year || 'All'
        });
    } catch (error) {
        console.error('Export options error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
