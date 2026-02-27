import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { calculateUserTwr } from '@/lib/twr';
import { getMarketData } from '@/lib/market-data';
import { fetchFredRatesForYear, calculateDailyInterest } from '@/lib/fred';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // Verify admin/manager access
        const token = req.cookies.get('token')?.value;
        if (!token) {
            return NextResponse.json({ error: '未授權' }, { status: 401 });
        }

        const decodedToken = await verifyToken(token);
        if (!decodedToken || (decodedToken.role !== 'admin' && decodedToken.role !== 'manager')) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { id } = await params;
        const userId = parseInt(id);

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // 1. Get user profile
        const user = await db.prepare(`
            SELECT id, user_id, email, initial_cost, year
            FROM USERS
            WHERE id = ?
        `).bind(userId).first();

        if (!user) {
            return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
        }

        const currentYear = new Date().getFullYear();

        // 2. Get latest daily net equity record
        const latestEquity = await db.prepare(`
            SELECT net_equity, cash_balance, date
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ?
            ORDER BY date DESC
            LIMIT 1
        `).bind(userId, currentYear).first();

        const accountNetWorth = latestEquity?.net_equity || 0;
        const cashBalance = latestEquity?.cash_balance || 0;

        // 3. Get deposits sum
        const depositsResult = await db.prepare(`
            SELECT COALESCE(SUM(deposit), 0) as total_deposit
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ?
        `).bind(userId, currentYear).first();

        const totalDeposit = depositsResult?.total_deposit || 0;

        // 4. Calculate cost and profit
        const cost2026 = (user.initial_cost || 0) + totalDeposit;
        const netProfit2026 = accountNetWorth - cost2026;

        // 5. Get performance statistics using THE SAME calculation as performance overview
        const { results: equityRecords } = await db.prepare(`
            SELECT date, net_equity, cash_balance, deposit
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ?
            ORDER BY date ASC
        `).bind(userId, currentYear).all();

        // Prepare data in the format expected by calculateUserTwr (same as net-equity API)
        const uEq = equityRecords || [];
        const uDep = uEq.filter((r: any) => r.deposit && r.deposit !== 0).map((r: any) => ({
            deposit_date: r.date,
            amount: Math.abs(r.deposit),
            transaction_type: r.deposit > 0 ? 'deposit' : 'withdrawal'
        }));

        // Fetch market data
        const startOfYear = new Date(Date.UTC(currentYear, 0, 1)).getTime() / 1000;
        const prevYearDec31 = new Date(Date.UTC(currentYear - 1, 11, 31)).getTime() / 1000;
        const endOfYear = Math.floor(Date.now() / 1000);

        let qqqData: any[] = [];
        let qldData: any[] = [];
        try {
            const [qData, lData] = await Promise.all([
                getMarketData('QQQ', startOfYear - 86400 * 5, endOfYear),
                getMarketData('QLD', startOfYear - 86400 * 5, endOfYear)
            ]);
            qqqData = qData;
            qldData = lData;
        } catch (error) {
            console.error('Failed to fetch market data:', error);
        }

        //  Call the SHARED calculation function - guarantees matching performance overview!
        const twrResult = calculateUserTwr(
            uEq as any,
            uDep as any,
            user.initial_cost || 0,
            prevYearDec31,
            qqqData,
            qldData
        );

        // Extract stats - these will match performance overview 100%
        const ytdReturn = twrResult.summary.stats?.returnPercentage || 0;
        const maxDrawdown = twrResult.summary.stats?.maxDrawdown || 0;
        const sharpeRatio = twrResult.summary.stats?.sharpeRatio || 0;
        const annualStdDev = twrResult.summary.stats?.annualizedStdDev || 0;

        // 6. Get stock positions
        const { results: stockPositions } = await db.prepare(`
            SELECT symbol, SUM(quantity) as quantity
            FROM STOCK_TRADES
            WHERE owner_id = ? AND year = ? AND status = 'Open'
            GROUP BY symbol
            HAVING quantity > 0
            ORDER BY 
                CASE symbol
                    WHEN 'QQQ' THEN 1
                    WHEN 'QLD' THEN 2
                    WHEN 'TQQQ' THEN 3
                    ELSE 4
                END,
                symbol
        `).bind(userId, currentYear).all();

        // 7. Get monthly premium stats - USE SAME QUERY AS /api/users for consistency
        const statsQuery = `
            SELECT 
                owner_id as user_id,
                strftime('%m', datetime(open_date, 'unixepoch')) as month,
                type,
                SUM(COALESCE(final_profit, 0)) as profit,
                SUM(
                    (strike_price * ABS(quantity) * 100) * 
                    (
                        (
                            CASE 
                                WHEN settlement_date IS NOT NULL THEN settlement_date 
                                WHEN to_date IS NOT NULL THEN to_date
                                ELSE unixepoch() 
                            END - open_date
                        ) / 86400.0
                    )
                ) as turnover
            FROM OPTIONS
            WHERE strftime('%Y', datetime(open_date, 'unixepoch')) = ?
            AND owner_id = ?
            GROUP BY month, type
        `;

        const { results: statsResults } = await db.prepare(statsQuery).bind(currentYear.toString(), userId).all();

        // Aggregate statistics by month
        const monthlyData: Record<string, { total: number; put: number; call: number; turnover: number }> = {};

        (statsResults as any[]).forEach((row: any) => {
            if (!monthlyData[row.month]) {
                monthlyData[row.month] = { total: 0, put: 0, call: 0, turnover: 0 };
            }

            monthlyData[row.month].total += row.profit;
            monthlyData[row.month].turnover += (row.turnover || 0);
            if (row.type === 'PUT') {
                monthlyData[row.month].put += row.profit;
            } else if (row.type === 'CALL') {
                monthlyData[row.month].call += row.profit;
            }
        });

        // Create monthly stats array (all 12 months)
        const monthlyStats = [];
        for (let i = 1; i <= 12; i++) {
            const monthStr = i.toString().padStart(2, '0');
            const data = monthlyData[monthStr] || { total: 0, put: 0, call: 0, turnover: 0 };
            monthlyStats.push({
                month: parseInt(monthStr),
                total_profit: data.total,
                put_profit: data.put,
                call_profit: data.call,
                turnover: data.turnover
            });
        }

        // Calculate quarterly and annual premium
        const currentMonth = new Date().getMonth() + 1;
        const currentQuarter = Math.ceil(currentMonth / 3);
        const startMonth = (currentQuarter - 1) * 3 + 1;
        const endMonth = startMonth + 2;

        const quarterlyPremium = monthlyStats
            .filter((s: any) => s.month >= startMonth && s.month <= endMonth)
            .reduce((sum: number, s: any) => sum + (s.total_profit || 0), 0);

        const annualPremium = monthlyStats.reduce((sum: number, s: any) => sum + (s.total_profit || 0), 0);

        // Calculate targets - Use initial cost instead of current equity
        const initialCost = (user.initial_cost || 0) + totalDeposit;
        const annualTarget = Math.round(initialCost * 0.04);
        const quarterlyTarget = Math.round(annualTarget / 4);

        // 8. Get margin rate
        const marginResult = await db.prepare(`
            SELECT COALESCE(SUM(ABS(quantity) * strike_price * 100), 0) as open_put_covered_capital
            FROM OPTIONS
            WHERE owner_id = ? AND year = ? AND operation = 'Open' AND type = 'PUT'
        `).bind(userId, currentYear).first();

        // Include debt (negative cash balance) in margin rate calculation to match dashboard logic
        const debt = Math.abs(Math.min(0, cashBalance));
        const marginUsed = (marginResult?.open_put_covered_capital || 0) + debt;
        const marginRate = accountNetWorth > 0 ? marginUsed / accountNetWorth : 0;

        // Calculate daily interest using FRED rate
        let dailyInterest = 0;
        const cashNum = Number(cashBalance) || 0;
        if (cashNum < 0 && latestEquity?.date) {
            const dateNum = Number(latestEquity.date);
            try {
                const fredRateMap = await fetchFredRatesForYear(currentYear);
                dailyInterest = calculateDailyInterest(cashNum, dateNum, fredRateMap);
            } catch (err) {
                console.warn('Failed to fetch FRED rates for report, using fallback:', err);
                // Fallback: use hardcoded rate (3.64% + spread) / 360
                const loanAmount = Math.abs(cashNum);
                const spread = loanAmount <= 100000 ? 1.5 : loanAmount <= 1000000 ? 1.0 : 0.5;
                dailyInterest = -(loanAmount * (3.64 + spread) / 100 / 360);
            }
        }

        // 9. Get open positions
        const { results: openOptions } = await db.prepare(`
            SELECT SUM(quantity) as quantity, to_date, type, underlying, strike_price, SUM(premium) as premium
            FROM OPTIONS
            WHERE owner_id = ? AND year = ? AND operation = 'Open'
            GROUP BY to_date, underlying, type, strike_price
            ORDER BY 
                CASE underlying
                    WHEN 'QQQ' THEN 1
                    WHEN 'QLD' THEN 2
                    WHEN 'TQQQ' THEN 3
                    ELSE 4
                END,
                underlying, to_date, type
        `).bind(userId, currentYear).all();

        return NextResponse.json({
            success: true,
            reportData: {
                user_id: user.user_id || user.email.split('@')[0],
                accountNetWorth,
                cost2026,
                netProfit2026,
                cashBalance,
                dailyInterest,
                marginRate,
                ytdReturn,
                maxDrawdown,
                sharpeRatio,
                annualStdDev,
                stockPositions: stockPositions || [],
                quarterlyPremium,
                quarterlyTarget,
                annualPremium,
                annualTarget,
                openOptions: openOptions || [],
                lastUpdateDate: latestEquity?.date || null
            }
        });

    } catch (error) {
        console.error('Generate report error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
