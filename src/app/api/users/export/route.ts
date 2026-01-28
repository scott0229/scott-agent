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

// Extracting logic is safer. Use `executeExport`
// Extracting logic is safer. Use `executeExport`
// Extracting logic is safer. Use `executeExport`
async function executeExport(req: NextRequest, year: string | null, userIds: number[] | null, includeMarketData: boolean = true, includeDepositRecords: boolean = true, includeOptionsRecords: boolean = true, includeInterestRecords: boolean = true, includeFeeRecords: boolean = true, includeStockRecords: boolean = true) {
    const db = await getDb();

    let query = `SELECT id, user_id, email, role, management_fee, ib_account, phone, avatar_url, initial_cost, year
            FROM USERS 
            WHERE email != 'admin'`;

    const params: any[] = [];
    const whereClauses: string[] = [];

    if (year && year !== 'All') {
        // Broaden filter: Include users who belong to the year OR have activity in that year
        whereClauses.push(`(
            year = ? 
            OR id IN (SELECT DISTINCT user_id FROM DAILY_NET_EQUITY WHERE year = ? AND deposit != 0)
            OR id IN (SELECT DISTINCT owner_id FROM OPTIONS WHERE year = ?)

            OR id IN (SELECT DISTINCT owner_id FROM STOCK_TRADES WHERE year = ?)
        )`);
        params.push(parseInt(year)); // year = ?
        params.push(parseInt(year)); // DEPOSITS activity (via DAILY_NET_EQUITY)
        params.push(parseInt(year)); // OPTIONS activity

        params.push(parseInt(year)); // stock activity
    }

    if (userIds && userIds.length > 0) {
        whereClauses.push(`id IN (${userIds.map(() => '?').join(',')})`);
        params.push(...userIds);
    }

    if (whereClauses.length > 0) {
        query += ` AND ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY id ASC`;

    const result = await db.prepare(query).bind(...params).all();
    const users = result.results || [];

    // Fetch Market Data for Benchmarks (Global)
    let qqqData: any[] = [];
    let qldData: any[] = [];

    try {
        const now = Math.floor(Date.now() / 1000);
        let startFetch = 1577836800; // 2020-01-01 defaults
        if (year && year !== 'All') {
            const y = parseInt(year);
            startFetch = new Date(Date.UTC(y - 1, 11, 20)).getTime() / 1000;
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

    // Fetch deposits for each user (Internal validation/calc usage)
    for (const user of users) {
        // Legacy DEPOSITS table query removed. 
        // We no longer export separate deposits array as it is now integrated into net_equity
        (user as any).deposits = [];

        let netEquityQuery = `
            SELECT date, net_equity, COALESCE(cash_balance, 0) as cash_balance, COALESCE(deposit, 0) as deposit, COALESCE(management_fee, 0) as management_fee, COALESCE(interest, 0) as interest, year
            FROM DAILY_NET_EQUITY
            WHERE user_id = ?
        `;
        const netEquityParams: any[] = [user.id];

        if (year && year !== 'All') {
            netEquityQuery += ` AND year = ?`;
            netEquityParams.push(parseInt(year));
        }

        netEquityQuery += ` ORDER BY date ASC`;

        const { results: netEquityRecords } = await db.prepare(netEquityQuery).bind(...netEquityParams).all();
        (user as any).net_equity_records = netEquityRecords || [];

        const uEq = (user as any).net_equity_records as any[];

        // Synthesize deposits from net_equity.deposit for TWR calculation
        // This ensures the exported stats match what the new system calculates
        const uDep = uEq.filter(r => r.deposit && r.deposit !== 0).map(r => ({
            deposit_date: r.date,
            amount: Math.abs(r.deposit),
            transaction_type: r.deposit > 0 ? 'deposit' : 'withdrawal'
        }));

        let benchStartDate = 0;
        if (year && year !== 'All') {
            benchStartDate = new Date(Date.UTC(parseInt(year) - 1, 11, 31)).getTime() / 1000;
        } else if (uEq.length > 0) {
            benchStartDate = uEq[0].date;
        }

        const processed = calculateUserTwr(uEq, uDep, (user as any).initial_cost, benchStartDate, qqqData, qldData);
        (user as any).performance_stats = processed.summary.stats;

        const startDateForBench = benchStartDate || (uEq.length > 0 ? uEq[0].date : 0);
        const lastDate = uEq.length > 0 ? uEq[uEq.length - 1].date : 0;
        if (uEq.length > 0) {
            (user as any).qqq_stats = calculateBenchmarkStats(qqqData, startDateForBench, lastDate, (user as any).initial_cost, uDep);
            (user as any).qld_stats = calculateBenchmarkStats(qldData, startDateForBench, lastDate, (user as any).initial_cost, uDep);
        } else {
            (user as any).qqq_stats = null;
            (user as any).qld_stats = null;
        }

        let optionsQuery = `
            SELECT 
                id, status, operation, open_date, to_date, settlement_date, days_to_expire, days_held,
                quantity, underlying, type, strike_price, collateral, premium,
                final_profit, profit_percent, delta, iv, capital_efficiency, year
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

        // Conditionally include options based on flag
        if (includeOptionsRecords) {
            (user as any).options = options || [];
        } else {
            (user as any).options = [];
        }



        let stocksQuery = `
            SELECT 
                id, symbol, status, open_date, close_date, open_price, close_price, quantity, year
            FROM STOCK_TRADES 
            WHERE owner_id = ?
        `;
        const stocksParams: any[] = [user.id];
        if (year && year !== 'All') {
            stocksQuery += ` AND year = ?`;
            stocksParams.push(parseInt(year));
        }
        stocksQuery += ` ORDER BY open_date DESC`;
        const { results: stocks } = await db.prepare(stocksQuery).bind(...stocksParams).all();

        if (includeStockRecords) {
            (user as any).stock_trades = stocks || [];
        } else {
            (user as any).stock_trades = [];
        }
    }

    let minExportDate = Number.MAX_SAFE_INTEGER;
    let maxExportDate = 0;
    for (const user of users) {
        const records = (user as any).net_equity_records as any[];
        if (records && records.length > 0) {
            const firstDate = records[0].date;
            const lastDate = records[records.length - 1].date;
            if (firstDate < minExportDate) minExportDate = firstDate;
            if (lastDate > maxExportDate) maxExportDate = lastDate;
        }
    }

    let marketPrices: any[] = [];
    const shouldExportMarketData = includeMarketData;

    if (shouldExportMarketData) {
        let marketPricesQuery = `SELECT symbol, date, close_price FROM market_prices`;
        const marketPricesParams: any[] = [];
        if (minExportDate !== Number.MAX_SAFE_INTEGER && maxExportDate !== 0) {
            const bufferSeconds = 20 * 86400;
            const startFilter = minExportDate - bufferSeconds;
            const endFilter = maxExportDate + 86400;
            marketPricesQuery += ` WHERE date >= ? AND date <= ?`;
            marketPricesParams.push(startFilter, endFilter);
        } else if (year && year !== 'All') {
            const startOfYear = new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000;
            const endOfYear = new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000;
            const startFilter = startOfYear - (20 * 86400);
            marketPricesQuery += ` WHERE date >= ? AND date <= ?`;
            marketPricesParams.push(startFilter, endOfYear);
        }
        marketPricesQuery += ` ORDER BY symbol ASC, date ASC`;

        try {
            const { results } = await db.prepare(marketPricesQuery).bind(...marketPricesParams).all();
            marketPrices = results || [];
        } catch (err) {
            console.error('Failed to fetch export market prices', err);
        }
    }

    // Remove id field from users before export (used internally for queries only)
    for (const user of users) {
        delete (user as any).id;
    }

    return {
        users,
        market_prices: marketPrices,
        exportDate: new Date().toISOString(),
        sourceYear: year || 'All',
        count: users.length
    };
}



// GET: Export all users (Legacy/Simple)
export async function GET(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) return NextResponse.json({ error: '權限不足' }, { status: 403 });

        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');

        const data = await executeExport(req, year, null, true, true, true, true, true, true);
        return NextResponse.json(data);
    } catch (error) {
        console.error('Export users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

// POST: Export selected users
export async function POST(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) return NextResponse.json({ error: '權限不足' }, { status: 403 });

        const body = await req.json();
        const { year, userIds, includeMarketData, includeDepositRecords, includeOptionsRecords, includeInterestRecords, includeFeeRecords, includeStockRecords } = body;
        // Default includeDepositRecords to true if undefined
        const safeIncludeDeposits = includeDepositRecords !== undefined ? includeDepositRecords : true;
        const safeIncludeOptions = includeOptionsRecords !== undefined ? includeOptionsRecords : true;
        const safeIncludeInterest = includeInterestRecords !== undefined ? includeInterestRecords : true;
        const safeIncludeFees = includeFeeRecords !== undefined ? includeFeeRecords : true;
        const safeIncludeStocks = includeStockRecords !== undefined ? includeStockRecords : true;

        const data = await executeExport(req, year, userIds || null, includeMarketData, safeIncludeDeposits, safeIncludeOptions, safeIncludeInterest, safeIncludeFees, safeIncludeStocks);
        return NextResponse.json(data);
    } catch (error) {
        console.error('Export users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
