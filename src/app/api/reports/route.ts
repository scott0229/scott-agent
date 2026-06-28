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

        // 總入金 per IB account, summed straight from DAILY_NET_EQUITY.deposit
        // (already in D1 — parsed once at statement import). One account maps to
        // several USERS rows (one per year), so we sum across all of them. This
        // is a tiny aggregate (a handful of deposit rows per account), not a
        // re-parse of the archived .htm files, so there's no cached column to
        // maintain. Net of withdrawals, matching the 成本/net_deposit convention.
        const deposits: Record<string, number> = {};
        try {
            const depRows = await db.prepare(`
                SELECT u.ib_account AS ib_account, COALESCE(SUM(d.deposit), 0) AS total_deposit
                FROM DAILY_NET_EQUITY d
                JOIN USERS u ON u.id = d.user_id
                WHERE u.ib_account IS NOT NULL AND u.ib_account != ''
                GROUP BY u.ib_account
            `).all<{ ib_account: string; total_deposit: number }>();
            (depRows.results || []).forEach((r: { ib_account: string; total_deposit: number }) => {
                deposits[r.ib_account] = r.total_deposit;
            });
        } catch (e) {
            console.warn('deposit sum failed (non-fatal):', e);
        }

        return NextResponse.json({ reports: results.results, deposits });

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
        const idsParam = request.nextUrl.searchParams.get('ids');

        if (idsParam) {
            // Used by the 未分類 bucket: those files share no filename pattern
            // (e.g. `MULTI_20260527.htm` carries no account ID), so the LIKE
            // branch below can't target them. Client passes explicit row IDs.
            const ids = idsParam
                .split(',')
                .map(s => parseInt(s, 10))
                .filter(n => Number.isInteger(n) && n > 0);
            if (ids.length === 0) {
                return NextResponse.json({ success: true, deleted: 0 });
            }
            const placeholders = ids.map(() => '?').join(',');
            await db.prepare(`DELETE FROM report_archives WHERE id IN (${placeholders})`)
                .bind(...ids)
                .run();
            return NextResponse.json({ success: true, deleted: ids.length });
        }

        if (accountId) {
            await db.prepare('DELETE FROM report_archives WHERE filename LIKE ?')
                .bind(`%${accountId}%`)
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

