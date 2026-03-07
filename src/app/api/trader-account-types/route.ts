import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Reuse the same API key auth pattern as trader-group
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

// Map D1 account_capability values to trader app account type keys
function mapCapability(cap: string | null): string | null {
    if (!cap) return null;
    const normalized = cap.trim();
    if (normalized === '投資組合保證金') return 'portfolio_margin';
    if (normalized === '保證金') return 'reg_t';
    if (normalized === '現金帳戶' || normalized === '現金') return 'cash';
    return null;
}

// GET /api/trader-account-types?accounts=U123,U456
// Returns account capability (account type) for the given IB accounts from D1.
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
        const yearsToTry = [currentYear, currentYear - 1];

        const groups: { dbName: string }[] = [
            { dbName: 'advisor' },
            { dbName: 'scott' },
        ];

        const accountTypes: Record<string, string> = {};

        for (const year of yearsToTry) {
            for (const g of groups) {
                const db = await getDb(g.dbName);
                const placeholders = accountIds.map(() => '?').join(',');
                const query = `SELECT ib_account, account_capability FROM USERS WHERE ib_account IN (${placeholders}) AND year = ? AND account_capability IS NOT NULL AND account_capability != ''`;
                const rows = await db.prepare(query).bind(...accountIds, year).all() as {
                    results: { ib_account: string; account_capability: string }[]
                };
                for (const row of (rows.results || [])) {
                    if (row.ib_account && !accountTypes[row.ib_account]) {
                        const mapped = mapCapability(row.account_capability);
                        if (mapped) {
                            accountTypes[row.ib_account] = mapped;
                        }
                    }
                }
            }
            // If we found any results in this year, stop
            if (Object.keys(accountTypes).length > 0) break;
        }

        return NextResponse.json({ accountTypes });
    } catch (error) {
        console.error('GET trader-account-types error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
