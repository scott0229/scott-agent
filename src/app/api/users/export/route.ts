import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { getMarketData } from '@/lib/market-data';
import { calculateBenchmarkStats, calculateUserTwr } from '@/lib/twr';

// Helper to check for admin or manager role
export const dynamic = 'force-dynamic';

async function checkAdmin(req: NextRequest) {
    const token = req.cookies.get('token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'manager')) {
        return null;
    }
    return payload;
}

// GET: Export all users (except admin) as JSON
export async function GET(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');

        const db = await getDb();

        let query = `SELECT id, user_id, email, role, management_fee, ib_account, phone, avatar_url, initial_cost, year
             FROM USERS 
             WHERE email != 'admin'`;

        const params: any[] = [];

        if (year && year !== 'All') {
            query += ` AND year = ?`;
            params.push(parseInt(year));
        }

        query += ` ORDER BY id ASC`;

        const result = await db.prepare(query).bind(...params).all();

        const users = result.results || [];

        // Fetch Market Data for Benchmarks (Global)
        // We fetch a reasonable history (e.g. from 2020) to ensure we cover most needs if specific year not set,
        // or strictly for the year. To be safe, let's fetch generous history.
        // Or if year is set, just that year (plus margin).

        let qqqData: any[] = [];
        let qldData: any[] = [];

        try {
            const now = Math.floor(Date.now() / 1000);
            let startFetch = 1577836800; // 2020-01-01 defaults
            if (year && year !== 'All') {
                const y = parseInt(year);
                startFetch = new Date(Date.UTC(y - 1, 11, 20)).getTime() / 1000; // Dec 20 prev year
            }

            const [q, l] = await Promise.all([
                getMarketData('QQQ', startFetch, now),
                getMarketData('QLD', startFetch, now)
            ]);
            qqqData = q;
            qldData = l;
        } catch (e) {
            console.error('Export: Failed to fetch market data', e);
        }

        // Fetch deposits for each user
        for (const user of users) {
            let depositQuery = `
                SELECT 
                    d.*,
                    u.user_id as depositor_user_id,
                    u.email as depositor_email
                FROM DEPOSITS d
                LEFT JOIN USERS u ON d.user_id = u.id
                WHERE d.user_id = ?
            `;
            const depositParams: any[] = [user.id];

            if (year && year !== 'All') {
                depositQuery += ` AND d.year = ?`;
                depositParams.push(parseInt(year));
            }

            depositQuery += ` ORDER BY d.deposit_date DESC`;

            const { results: deposits } = await db.prepare(depositQuery).bind(...depositParams).all();
            (user as any).deposits = deposits || [];

            // Fetch net equity records for each user
            let netEquityQuery = `
                SELECT date, net_equity, year
                FROM DAILY_NET_EQUITY
                WHERE user_id = ?
            `;
            const netEquityParams: any[] = [user.id];

            if (year && year !== 'All') {
                netEquityQuery += ` AND year = ?`;
                netEquityParams.push(parseInt(year));
            }

            netEquityQuery += ` ORDER BY date ASC`; // Sorted ASC for calc

            const { results: netEquityRecords } = await db.prepare(netEquityQuery).bind(...netEquityParams).all();
            (user as any).net_equity_records = netEquityRecords || [];

            // Calculate Performance Stats
            const uEq = (user as any).net_equity_records as any[];
            const uDep = (user as any).deposits as any[];

            // Determine start date for benchmarks
            let benchStartDate = 0;
            if (year && year !== 'All') {
                benchStartDate = new Date(Date.UTC(parseInt(year) - 1, 11, 31)).getTime() / 1000;
            } else if (uEq.length > 0) {
                benchStartDate = uEq[0].date;
            }

            const processed = calculateUserTwr(uEq, uDep, (user as any).initial_cost, benchStartDate, qqqData, qldData);

            (user as any).performance_stats = processed.summary.stats; // Current User Performance

            // Calculate Benchmark Stats
            const lastDate = uEq.length > 0 ? uEq[uEq.length - 1].date : 0;
            // Ensure benchStartDate is valid for `calculateBenchmarkStats`
            // logic inside calculateUserTwr handled fallback, we need to do same
            const startDateForBench = benchStartDate || (uEq.length > 0 ? uEq[0].date : 0);

            if (uEq.length > 0) {
                (user as any).qqq_stats = calculateBenchmarkStats(qqqData, startDateForBench, lastDate, (user as any).initial_cost, uDep);
                (user as any).qld_stats = calculateBenchmarkStats(qldData, startDateForBench, lastDate, (user as any).initial_cost, uDep);
            } else {
                (user as any).qqq_stats = null;
                (user as any).qld_stats = null;
            }

            // Fetch options trading records for each user
            let optionsQuery = `
                SELECT *
                FROM OPTIONS
                WHERE owner_id = ?
            `;
            const optionsParams: any[] = [user.id];

            if (year && year !== 'All') {
                optionsQuery += ` AND year = ?`;
                optionsParams.push(parseInt(year));
            }

            optionsQuery += ` ORDER BY open_date DESC`;

            const { results: options } = await db.prepare(optionsQuery).bind(...optionsParams).all();
            (user as any).options = options || [];

            // Fetch monthly interest for each user
            let interestQuery = `
                SELECT year, month, interest
                FROM monthly_interest
                WHERE user_id = ?
            `;
            const interestParams: any[] = [user.id];

            if (year && year !== 'All') {
                interestQuery += ` AND year = ?`;
                interestParams.push(parseInt(year));
            }

            interestQuery += ` ORDER BY year DESC, month DESC`;

            const { results: interest } = await db.prepare(interestQuery).bind(...interestParams).all();
            (user as any).monthly_interest = interest || [];
        }

        // Fetch market prices (Benchmark data)
        // We export ALL market prices or filter by year if requested?
        // Usually benchmark data is global. User asked for QQQ and QLD comparison data.
        // Let's export all market_prices for now, or filter if year is specified.
        let marketPricesQuery = `SELECT symbol, date, close_price FROM market_prices`;
        const marketPricesParams: any[] = [];

        if (year && year !== 'All') {
            const startOfYear = new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000;
            const endOfYear = new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000;
            marketPricesQuery += ` WHERE date >= ? AND date <= ?`;
            marketPricesParams.push(startOfYear, endOfYear);
        }

        marketPricesQuery += ` ORDER BY symbol ASC, date ASC`;

        const { results: marketPrices } = await db.prepare(marketPricesQuery).bind(...marketPricesParams).all();

        return NextResponse.json({
            users,
            market_prices: marketPrices || [],
            exportDate: new Date().toISOString(),
            count: users.length
        });
    } catch (error) {
        console.error('Export users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
