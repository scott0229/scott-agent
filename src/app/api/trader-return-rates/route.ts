import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { calculateUserTwr } from '@/lib/twr';

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

// GET /api/trader-return-rates?accounts=U123,U456
// Returns return rate (報酬率) for the given IB accounts, calculated the same way as 績效總覽.
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

        const groups: { dbName: string }[] = [
            { dbName: 'advisor' },
            { dbName: 'scott' },
        ];

        const returnRates: Record<string, number | null> = {};

        for (const g of groups) {
            const db = await getDb(g.dbName);
            const placeholders = accountIds.map(() => '?').join(',');

            // Find users matching these IB accounts in the current year
            const usersQuery = `SELECT id, ib_account, initial_cost FROM USERS WHERE ib_account IN (${placeholders}) AND year = ? AND role = 'customer'`;
            const users = await db.prepare(usersQuery).bind(...accountIds, currentYear).all() as {
                results: { id: number; ib_account: string; initial_cost: number }[]
            };

            if (!users.results || users.results.length === 0) continue;

            for (const user of users.results) {
                if (returnRates[user.ib_account] !== undefined) continue; // Already found

                // Fetch daily net equity records for this user
                const equityRecords = await db.prepare(
                    `SELECT date, net_equity, deposit FROM DAILY_NET_EQUITY WHERE user_id = ? AND year = ? ORDER BY date ASC`
                ).bind(user.id, currentYear).all();

                const uEq = (equityRecords.results as any[]) || [];

                if (uEq.length === 0) {
                    returnRates[user.ib_account] = null;
                    continue;
                }

                // Synthesize deposits from the deposit column
                const uDep = uEq.filter((r: any) => r.deposit && r.deposit !== 0).map((r: any) => ({
                    deposit_date: r.date,
                    amount: Math.abs(r.deposit),
                    transaction_type: r.deposit > 0 ? 'deposit' : 'withdrawal'
                }));

                // Calculate TWR (same as 績效總覽)
                const processed = calculateUserTwr(uEq, uDep, user.initial_cost || 0, 0, [], []);

                if (processed.summary.stats) {
                    // returnPercentage is decimal (e.g., -0.0156 for -1.56%)
                    returnRates[user.ib_account] = processed.summary.stats.returnPercentage * 100;
                } else {
                    returnRates[user.ib_account] = null;
                }
            }
        }

        return NextResponse.json({ returnRates });
    } catch (error) {
        console.error('GET trader-return-rates error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
