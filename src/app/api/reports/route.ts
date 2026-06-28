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

        // 總入金 per IB account, bounded to that account's REPORT date range
        // (the card's 時間範圍 — min..max statement_date), so it spans the whole
        // uploaded-statement window across years rather than a single year and
        // excludes any deposit outside the archived range. Source is
        // DAILY_NET_EQUITY.deposit (already parsed into D1 at import), summed
        // across the account's yearly USERS rows — a tiny aggregate, no .htm
        // re-parse and no cached column to maintain. Net of withdrawals,
        // matching the 成本/net_deposit convention.
        const accountOf = (filename: string): string | null => {
            const m = filename.match(/^([A-Z]+\d+)_/i);
            if (m) return m[1].toUpperCase();
            const u = filename.match(/(U\d+)/i);
            return u ? u[1].toUpperCase() : null;
        };
        // Per-account [min, max] statement_date from the fetched archive rows.
        const range: Record<string, { min: string; max: string }> = {};
        for (const r of (results.results as { filename: string; statement_date: string }[])) {
            const acct = accountOf(r.filename);
            if (!acct || !r.statement_date) continue;
            const d = r.statement_date; // 'YYYY-MM-DD'
            if (!range[acct]) range[acct] = { min: d, max: d };
            else {
                if (d < range[acct].min) range[acct].min = d;
                if (d > range[acct].max) range[acct].max = d;
            }
        }
        const deposits: Record<string, number> = {};
        try {
            const depRows = await db.prepare(`
                SELECT u.ib_account AS ib_account,
                       date(datetime(d.date, 'unixepoch')) AS d_date,
                       d.deposit AS deposit
                FROM DAILY_NET_EQUITY d
                JOIN USERS u ON u.id = d.user_id
                WHERE u.ib_account IS NOT NULL AND u.ib_account != '' AND d.deposit != 0
            `).all<{ ib_account: string; d_date: string; deposit: number }>();
            for (const r of (depRows.results || []) as { ib_account: string; d_date: string; deposit: number }[]) {
                const rg = range[r.ib_account];
                if (!rg || !r.d_date) continue;
                if (r.d_date >= rg.min && r.d_date <= rg.max) {
                    deposits[r.ib_account] = (deposits[r.ib_account] || 0) + r.deposit;
                }
            }
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

