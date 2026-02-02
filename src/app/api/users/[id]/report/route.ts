import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

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

        const db = await getDb();

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

        // 2. Get latest daily net equity record for cash balance and net worth
        const latestEquity = await db.prepare(`
            SELECT 
                net_equity,
                cash_balance,
                date
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ?
            ORDER BY date DESC
            LIMIT 1
        `).bind(userId, currentYear).first();

        const accountNetWorth = latestEquity?.net_equity || 0;
        const cashBalance = latestEquity?.cash_balance || 0;

        // 3. Get deposits sum for current year
        const depositsResult = await db.prepare(`
            SELECT COALESCE(SUM(deposit), 0) as total_deposit
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ?
        `).bind(userId, currentYear).first();

        const totalDeposit = depositsResult?.total_deposit || 0;

        // 4. Calculate current year cost and profit
        const cost2026 = (user.initial_cost || 0) + totalDeposit;
        const netProfit2026 = accountNetWorth - cost2026;

        // 5. Get performance statistics from all daily records this year
        const { results: equityRecords } = await db.prepare(`
            SELECT 
                date,
                net_equity
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ?
            ORDER BY date ASC
        `).bind(userId, currentYear).all();

        let ytdReturn = 0;
        let maxDrawdown = 0;
        let sharpeRatio = 0;
        let annualStdDev = 0;

        if (equityRecords && equityRecords.length > 0) {
            const startEquity = equityRecords[0].net_equity;
            const currentEquity = equityRecords[equityRecords.length - 1].net_equity;

            // YTD Return
            ytdReturn = startEquity > 0 ? (currentEquity - startEquity) / startEquity : 0;

            // Calculate returns array for statistics
            const returns = [];
            for (let i = 1; i < equityRecords.length; i++) {
                const prevEquity = equityRecords[i - 1].net_equity;
                if (prevEquity > 0) {
                    const dailyReturn = (equityRecords[i].net_equity - prevEquity) / prevEquity;
                    returns.push(dailyReturn);
                }
            }

            // Max Drawdown
            let peak = equityRecords[0].net_equity;
            let maxDD = 0;
            for (const record of equityRecords) {
                if (record.net_equity > peak) {
                    peak = record.net_equity;
                }
                const drawdown = (peak - record.net_equity) / peak;
                if (drawdown > maxDD) {
                    maxDD = drawdown;
                }
            }
            maxDrawdown = maxDD;

            // Standard Deviation
            if (returns.length > 1) {
                const mean = returns.reduce((sum: number, r: number) => sum + r, 0) / returns.length;
                const variance = returns.reduce((sum: number, r: number) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
                const dailyStdDev = Math.sqrt(variance);
                annualStdDev = dailyStdDev * Math.sqrt(252); // Annualize (252 trading days)

                // Sharpe Ratio (assuming 0% risk-free rate for simplicity)
                const annualizedReturn = Math.pow(1 + mean, 252) - 1;
                sharpeRatio = annualStdDev > 0 ? annualizedReturn / annualStdDev : 0;
            }
        }

        // 6. Get stock positions (aggregate open positions by symbol)
        const { results: stockPositions } = await db.prepare(`
            SELECT 
                symbol,
                SUM(quantity) as quantity
            FROM STOCK_TRADES
            WHERE owner_id = ? AND year = ? AND status = 'Holding'
            GROUP BY symbol
            HAVING quantity > 0
            ORDER BY symbol
        `).bind(userId, currentYear).all();

        // 7. Get monthly stats for premium calculation using settlement_date
        const { results: monthlyStats } = await db.prepare(`
            SELECT 
                CAST(strftime('%m', datetime(settlement_date, 'unixepoch')) AS INTEGER) as month,
                SUM(final_profit) as profit
            FROM OPTIONS
            WHERE owner_id = ? AND year = ? AND operation != '持有中' AND settlement_date IS NOT NULL
            GROUP BY month
            ORDER BY month
        `).bind(userId, currentYear).all();

        // Calculate quarterly and annual premium
        const currentMonth = new Date().getMonth() + 1; // 1-12
        const currentQuarter = Math.ceil(currentMonth / 3);
        const startMonth = (currentQuarter - 1) * 3 + 1;
        const endMonth = startMonth + 2;

        const quarterlyPremium = monthlyStats
            .filter((s: any) => s.month >= startMonth && s.month <= endMonth)
            .reduce((sum: number, s: any) => sum + (s.profit || 0), 0);

        const annualPremium = monthlyStats.reduce((sum: number, s: any) => sum + (s.profit || 0), 0);

        // Calculate targets (4% annual, quarterly is 1/4 of that)
        const annualTarget = Math.round(accountNetWorth * 0.04);
        const quarterlyTarget = Math.round(annualTarget / 4);

        // 8. Get margin rate from open put positions (using operation='持有中' to identify open positions)
        const marginResult = await db.prepare(`
            SELECT 
                COALESCE(SUM(ABS(quantity) * strike_price * 100), 0) as open_put_covered_capital
            FROM OPTIONS
            WHERE owner_id = ? 
              AND year = ?
              AND operation = '持有中' 
              AND type = 'PUT'
        `).bind(userId, currentYear).first();

        const marginRate = accountNetWorth > 0 ? (marginResult?.open_put_covered_capital || 0) / accountNetWorth : 0;

        // 9. Get open option positions
        const { results: openOptions } = await db.prepare(`
            SELECT 
                quantity,
                to_date,
                type,
                underlying,
                strike_price,
                premium
            FROM OPTIONS
            WHERE owner_id = ? AND year = ? AND operation = '持有中'
            ORDER BY to_date, underlying, type
        `).bind(userId, currentYear).all();

        return NextResponse.json({
            success: true,
            reportData: {
                user_id: user.user_id || user.email.split('@')[0],
                accountNetWorth,
                cost2026,
                netProfit2026,
                cashBalance,
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
                openOptions: openOptions || []
            }
        });

    } catch (error) {
        console.error('Generate report error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
