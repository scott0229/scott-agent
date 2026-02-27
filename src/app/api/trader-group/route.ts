import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Reuse the same API key auth pattern as trader-settings
async function checkApiKey(req: NextRequest): Promise<boolean> {
    const { searchParams } = new URL(req.url);
    const qKey = searchParams.get('apiKey');
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    const key = qKey || headerKey;
    if (!key) return false;

    // Check against advisor DB (primary)
    const db = await getDb('advisor');
    const row = await db.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    if (row) return true;

    // Also check scott DB
    const dbScott = await getDb('scott');
    const row2 = await dbScott.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    return !!row2;
}

// GET /api/trader-group?accounts=U123,U456
// Detects which account group the given IB accounts belong to.
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

        // Build placeholders for IN clause
        const placeholders = accountIds.map(() => '?').join(',');
        const countQuery = `SELECT COUNT(DISTINCT ib_account) as cnt FROM USERS WHERE ib_account IN (${placeholders})`;
        const total = accountIds.length;

        // Check advisor DB: ALL accounts must be found
        const dbAdvisor = await getDb('advisor');
        const advisorResult = await dbAdvisor.prepare(countQuery).bind(...accountIds).first() as { cnt: number } | null;
        if (advisorResult && advisorResult.cnt >= total) {
            return NextResponse.json({ group: 'advisor', label: '顧問帳戶群' });
        }

        // Check scott DB: ALL accounts must be found
        const dbScott = await getDb('scott');
        const scottResult = await dbScott.prepare(countQuery).bind(...accountIds).first() as { cnt: number } | null;
        if (scottResult && scottResult.cnt >= total) {
            return NextResponse.json({ group: 'scott', label: 'SCOTT帳戶群' });
        }

        return NextResponse.json({ group: 'unknown', label: '未知群組' });
    } catch (error) {
        console.error('GET trader-group error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
