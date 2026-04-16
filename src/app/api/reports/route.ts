import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const limit = parseInt(request.nextUrl.searchParams.get('limit') || '5000');
        
        const results = await db.prepare(`
            SELECT id, filename, bucket_key, statement_date, created_at
            FROM report_archives
            ORDER BY statement_date DESC, created_at DESC
            LIMIT ?
        `).bind(limit).all();

        return NextResponse.json({ reports: results.results });

    } catch (error: any) {
        console.error('Fetch reports failed:', error);
        return NextResponse.json({ error: error.message || '讀取失敗' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const accountId = request.nextUrl.searchParams.get('accountId');

        if (accountId) {
            await db.prepare('DELETE FROM report_archives WHERE filename LIKE ?')
                .bind(`%${accountId}_%`)
                .run();
        } else {
            await db.prepare('DELETE FROM report_archives').run();
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Delete all reports failed:', error);
        return NextResponse.json({ error: error.message || '刪除失敗' }, { status: 500 });
    }
}

