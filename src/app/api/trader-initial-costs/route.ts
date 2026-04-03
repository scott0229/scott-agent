import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Reuse the same API key auth pattern as trader-account-types
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

// GET /api/trader-initial-costs?accounts=U123,U456
// Returns the weighted average open_price per account+symbol for open stock positions.
// Response: { initialCosts: { "U123|QQQ": 580.50, "U456|QLD": 65.20, ... } }
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

        // Use the same SQL as the report route to ensure matching values
        const initialCosts: Record<string, number> = {};
        // Track which ib_accounts we already found to avoid cross-DB duplication
        const foundAccounts = new Set<string>();

        for (const year of yearsToTry) {
            for (const g of groups) {
                const db = await getDb(g.dbName);
                const placeholders = accountIds.map(() => '?').join(',');

                // Same formula as report route: ROUND(SUM(open_price * quantity) / SUM(quantity), 2)
                const query = `
                    SELECT U.ib_account, ST.symbol,
                        SUM(ST.quantity) as total_qty,
                        ROUND(SUM(ST.open_price * ST.quantity) / SUM(ST.quantity), 2) as avg_cost
                    FROM STOCK_TRADES ST
                    JOIN USERS U ON ST.owner_id = U.id
                    WHERE U.ib_account IN (${placeholders})
                      AND ST.status = 'Open'
                      AND ST.year = ?
                      AND U.year = ?
                    GROUP BY U.ib_account, ST.symbol
                    HAVING total_qty > 0
                `;
                const rows = await db.prepare(query).bind(...accountIds, year, year).all() as {
                    results: { ib_account: string; symbol: string; total_qty: number; avg_cost: number }[]
                };

                for (const row of (rows.results || [])) {
                    if (!row.ib_account || !row.symbol) continue;
                    const key = `${row.ib_account}|${row.symbol}`;
                    // Only use the first DB result for each account to avoid duplication
                    if (!foundAccounts.has(key)) {
                        initialCosts[key] = row.avg_cost;
                        foundAccounts.add(key);
                    }
                }
            }
            // If we found results in this year, stop
            if (Object.keys(initialCosts).length > 0) break;
        }

        return NextResponse.json({ initialCosts });
    } catch (error) {
        console.error('GET trader-initial-costs error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
