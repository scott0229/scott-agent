import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Same Bearer api_key auth as trader-account-types.
async function checkApiKey(req: NextRequest): Promise<boolean> {
    const { searchParams } = new URL(req.url);
    const qKey = searchParams.get('apiKey');
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    const key = qKey || headerKey;
    if (!key) return false;

    const db = await getDb('advisor');
    const row = await db.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    if (row) return true;

    const dbScott = await getDb('scott');
    const row2 = await dbScott.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    return !!row2;
}

// GET /api/trader-report-notes?accounts=U123,U456
// Returns per-account USERS.report_note so the trader desktop can show the
// same daily-report note managers wrote on the website.
export async function GET(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req);
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const accountsParam = searchParams.get('accounts');

        if (!accountsParam) {
            return NextResponse.json({ error: 'Missing accounts parameter' }, { status: 400 });
        }

        const accountIds = accountsParam.split(',').map(a => a.trim()).filter(Boolean);
        if (accountIds.length === 0) {
            return NextResponse.json({ error: 'No valid accounts provided' }, { status: 400 });
        }

        const currentYear = new Date().getFullYear();

        const reportNotes: Record<string, string> = {};

        for (const dbName of ['advisor', 'scott']) {
            const db = await getDb(dbName);
            const placeholders = accountIds.map(() => '?').join(',');
            const query = `SELECT ib_account, report_note FROM USERS WHERE ib_account IN (${placeholders}) AND year = ?`;
            const rows = await db.prepare(query).bind(...accountIds, currentYear).all() as {
                results: { ib_account: string; report_note: string | null }[]
            };
            for (const row of (rows.results || [])) {
                if (!row.ib_account) continue;
                if (reportNotes[row.ib_account]) continue;
                if (row.report_note && row.report_note.trim()) {
                    reportNotes[row.ib_account] = row.report_note;
                }
            }
        }

        return NextResponse.json({ reportNotes });
    } catch (error) {
        console.error('GET trader-report-notes error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
