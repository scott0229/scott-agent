import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { calculateUserTwr } from '@/lib/twr';
import { getMarketData } from '@/lib/market-data';
import { fetchFredRatesForYear, calculateDailyInterest } from '@/lib/fred';
import { calculateMarginRate } from '@/lib/margin-rate';
import { computeDailyOptionProfits } from '@/lib/daily-profit-history';

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
            SELECT id, user_id, email, initial_cost, year, start_date, ib_account
            FROM USERS
            WHERE id = ?
        `).bind(userId).first();

        if (!user) {
            return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
        }

        // Year is driven by the client's selectedYear filter; fall back to
        // the current calendar year when not provided.
        const yearParam = req.nextUrl.searchParams.get('year');
        const parsedYear = yearParam && yearParam !== 'All' ? parseInt(yearParam, 10) : NaN;
        const currentYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear();

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

        // 3b. Lifetime 總入金 — net deposits across ALL years for this account
        // (an IB account has one USERS row per year). Falls back to the
        // year-scoped sum when the account has no ib_account to span on.
        let lifetimeDeposit = totalDeposit;
        if (user.ib_account) {
            const lifeRes = await db.prepare(`
                SELECT COALESCE(SUM(d.deposit), 0) as lifetime_deposit
                FROM DAILY_NET_EQUITY d
                JOIN USERS u ON u.id = d.user_id
                WHERE u.ib_account = ?
            `).bind(user.ib_account).first();
            lifetimeDeposit = lifeRes?.lifetime_deposit ?? totalDeposit;
        }

        // 4. Calculate cost and profit
        const cost2026 = (user.initial_cost || 0) + totalDeposit;
        const netProfit2026 = accountNetWorth - cost2026;
        // Cost base for 期權收益率 follows the canonical formula used by the
        // summary card (src/lib/options-metrics.ts → getPremiumCostBase):
        // initial_cost when it's set, otherwise fall back to deposits. This
        // is intentionally different from cost2026 (which adds deposits to
        // initial_cost) so the rate matches the card.
        const premiumCostBase = (user.initial_cost && user.initial_cost > 0)
            ? user.initial_cost
            : totalDeposit;

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

        // QQQ 同期報酬率 (TWR) for the 對比績效 line — the hypothetical "same cash
        // flows into QQQ" return that calculateUserTwr already computed per day.
        // Take the last day with a defined qqq_rate (% → fraction); null when no
        // QQQ market data was available.
        let qqqReturn: number | null = null;
        const twrHistory = twrResult.summary.equity_history || [];
        for (let i = twrHistory.length - 1; i >= 0; i--) {
            const r = (twrHistory[i] as any).qqq_rate;
            if (typeof r === 'number' && !Number.isNaN(r)) {
                qqqReturn = r / 100;
                break;
            }
        }

        // 6. Get stock positions
        const { results: stockPositions } = await db.prepare(`
            SELECT symbol, SUM(quantity) as quantity,
                ROUND(SUM(open_price * quantity) / SUM(quantity), 2) as avg_cost
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

        const qqqCurrentPrice = qqqData && qqqData.length > 0 ? qqqData[qqqData.length - 1].close : null;
        const qldCurrentPrice = qldData && qldData.length > 0 ? qldData[qldData.length - 1].close : null;
        const enhancedStockPositions = (stockPositions || []).map((pos: any) => {
            if (pos.symbol === 'QQQ' && qqqCurrentPrice) return { ...pos, current_price: qqqCurrentPrice };
            if (pos.symbol === 'QLD' && qldCurrentPrice) return { ...pos, current_price: qldCurrentPrice };
            return pos;
        });

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

        // Add stock P&L (include_in_options=1) for both Closed and Open positions
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const todayTimestamp = Math.floor(today.getTime() / 1000);

        const stockPnlQuery = `
            SELECT 
                strftime('%m', datetime(COALESCE(ST.close_date, ST.open_date), 'unixepoch')) as month,
                SUM(
                    CASE 
                        WHEN ST.status = 'Closed' THEN (ST.close_price - ST.open_price) * ST.quantity
                        WHEN ST.status = 'Open' AND MP.close_price IS NOT NULL THEN (MP.close_price - ST.open_price) * ST.quantity
                        ELSE 0
                    END
                ) as stock_pnl
            FROM STOCK_TRADES ST
            LEFT JOIN (
                SELECT symbol, close_price
                FROM market_prices
                WHERE (symbol, date) IN (
                    SELECT symbol, MAX(date)
                    FROM market_prices
                    WHERE date <= ?
                    GROUP BY symbol
                )
            ) MP ON ST.symbol = MP.symbol
            WHERE ST.owner_id = ? 
                AND ST.include_in_options = 1 
                AND strftime('%Y', datetime(COALESCE(ST.close_date, ST.open_date), 'unixepoch')) = ?
            GROUP BY month
        `;
        const { results: stockPnlResults } = await db.prepare(stockPnlQuery).bind(todayTimestamp, userId, currentYear.toString()).all();

        (stockPnlResults as any[]).forEach((row: any) => {
            if (!monthlyData[row.month]) {
                monthlyData[row.month] = { total: 0, put: 0, call: 0, turnover: 0 };
            }
            monthlyData[row.month].total += (row.stock_pnl || 0);
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

        let annualPremium = monthlyStats.reduce((sum: number, s: any) => sum + (s.total_profit || 0), 0);

        // Calculate targets - Use initial cost instead of current equity
        const initialCost = (user.initial_cost || 0) + totalDeposit;
        const premiumTargetPercent = parseFloat(req.nextUrl.searchParams.get('premiumTargetPercent') || '4');
        
        const targetStartOfYear = new Date(Date.UTC(currentYear, 0, 1));
        const targetEndOfYear = new Date(Date.UTC(currentYear, 11, 31));
        const totalDaysInYear = (targetEndOfYear.getTime() - targetStartOfYear.getTime()) / (1000 * 60 * 60 * 24) + 1;
        const userStartObj = user.start_date ? new Date(user.start_date) : targetStartOfYear;
        const effectiveStart = userStartObj > targetStartOfYear ? userStartObj : targetStartOfYear;
        const activeDaysInYear = (targetEndOfYear.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24) + 1;
        const proRataRatio = activeDaysInYear / totalDaysInYear;

        const annualTarget = Math.round(initialCost * (premiumTargetPercent / 100) * proRataRatio);
        const quarterlyTarget = Math.round(annualTarget / 4);

        // 8. Get margin rate
        const marginResult = await db.prepare(`
            SELECT COALESCE(SUM(ABS(quantity) * strike_price * 100), 0) as open_put_covered_capital
            FROM OPTIONS
            WHERE owner_id = ? AND year = ? AND operation = 'Open' AND type = 'PUT'
        `).bind(userId, currentYear).first();

        // 潛在融資 = max(0, put_capital - cash) / equity. Canonical formula in
        // src/lib/margin-rate.ts so the daily report agrees with every UI table.
        const marginRate = calculateMarginRate(
            marginResult?.open_put_covered_capital as number | null,
            cashBalance,
            accountNetWorth,
        );

        // Calculate daily interest using FRED rate. If the FRED fetch fails
        // (e.g. transient network error or rate limit on a cold isolate),
        // fall through with an empty rate map — calculateDailyInterest has
        // its own 3.64% fallback per record, so the accumulation loop still
        // produces a non-zero total. Previously the catch block only
        // backfilled dailyInterest and left totalDailyInterest at 0, which
        // silently zeroed out interest in the report's annualPremium.
        let fredRateMap: Record<string, number> = {};
        try {
            fredRateMap = await fetchFredRatesForYear(currentYear);
        } catch (err) {
            console.warn('Failed to fetch FRED rates for report, using per-record fallback:', err);
        }

        let dailyInterest = 0;
        let totalDailyInterest = 0;
        const cashNum = Number(cashBalance) || 0;
        if (latestEquity?.date) {
            dailyInterest = calculateDailyInterest(cashNum, Number(latestEquity.date), fredRateMap);
        }

        for (let i = 0; i < uEq.length; i++) {
            const row = uEq[i] as any;
            const todayInterest = calculateDailyInterest(row.cash_balance ?? 0, row.date, fredRateMap);
            let recordInterest = todayInterest;
            if (i > 0) {
                const prevDate = (uEq[i - 1] as any).date as number;
                const gapDays = Math.round((row.date - prevDate) / 86400);
                if (gapDays > 1) {
                    const prevDayInterest = calculateDailyInterest((uEq[i - 1] as any).cash_balance ?? 0, prevDate, fredRateMap);
                    recordInterest = prevDayInterest * (gapDays - 1) + todayInterest;
                }
            }
            totalDailyInterest += recordInterest;
        }

        // Add accumulated interest to annual premium
        annualPremium += totalDailyInterest;

        // Snapshot BEFORE the breach adjustment below. This is the
        // mode-independent "realized + open mark-to-market" total that the
        // 含/不含平倉費用 rates derive from, so they stay stable regardless
        // of the 只計入被突破 setting.
        const annualPremiumBeforeAdj = annualPremium;

        // 平倉費用「只計入被突破」adjustment. monthlyStats already rolled every
        // open position's final_profit (mark-to-market) into total_profit, so
        // to switch the open contribution to "OTM premium + ITM mark-to-
        // market" we add the net delta:
        //   (open_otm_premium + open_itm_final_profit) - open_all_final_profit
        // Mirrors src/lib/options-metrics.ts and the trade-groups 盈虧 column.
        const closeCostOnlyBreached = req.nextUrl.searchParams.get('closeCostOnlyBreached') === 'true';
        if (closeCostOnlyBreached) {
            try {
                const openAgg = await db.prepare(`
                    SELECT
                        COALESCE(SUM(CASE
                            WHEN O.type = 'CALL' AND LP.close_price IS NOT NULL AND LP.close_price > O.strike_price THEN 0
                            WHEN O.type = 'PUT'  AND LP.close_price IS NOT NULL AND LP.close_price < O.strike_price THEN 0
                            ELSE O.premium
                        END), 0) AS open_otm_premium,
                        COALESCE(SUM(CASE
                            WHEN O.type = 'CALL' AND LP.close_price IS NOT NULL AND LP.close_price > O.strike_price THEN O.final_profit
                            WHEN O.type = 'PUT'  AND LP.close_price IS NOT NULL AND LP.close_price < O.strike_price THEN O.final_profit
                            ELSE 0
                        END), 0) AS open_itm_final_profit,
                        COALESCE(SUM(O.final_profit), 0) AS open_all_final_profit
                    FROM OPTIONS O
                    LEFT JOIN (
                        SELECT symbol, close_price
                        FROM market_prices mp1
                        WHERE date = (SELECT MAX(date) FROM market_prices mp2 WHERE mp2.symbol = mp1.symbol)
                    ) LP ON LP.symbol = O.underlying
                    WHERE O.owner_id = ? AND O.year = ? AND O.operation = 'Open'
                `).bind(userId, currentYear).first<{
                    open_otm_premium: number; open_itm_final_profit: number; open_all_final_profit: number;
                }>();
                if (openAgg) {
                    annualPremium += (openAgg.open_otm_premium + openAgg.open_itm_final_profit - openAgg.open_all_final_profit);
                }
            } catch (err) {
                console.warn('breach-mode open aggregate failed (non-fatal):', err);
            }
        }

        const highestEquityResult = await db.prepare(`
            SELECT MAX(net_equity) as max_net_equity
            FROM DAILY_NET_EQUITY
            WHERE user_id = ?
        `).bind(userId).first();
        const highestNetWorth = highestEquityResult?.max_net_equity || accountNetWorth;

        // 9. Get open positions
        const { results: openOptions } = await db.prepare(`
            SELECT SUM(quantity) as quantity, to_date, type, underlying, strike_price, group_id as trade_group, SUM(premium) as premium
            FROM OPTIONS
            WHERE owner_id = ? AND year = ? AND operation = 'Open'
            GROUP BY to_date, underlying, type, strike_price, group_id
            ORDER BY
                CASE WHEN SUM(quantity) < 0 THEN 1 ELSE 2 END,
                CASE underlying
                    WHEN 'QQQ' THEN 1
                    WHEN 'QLD' THEN 2
                    WHEN 'TQQQ' THEN 3
                    ELSE 4
                END,
                underlying,
                CASE type WHEN 'CALL' THEN 1 WHEN 'PUT' THEN 2 ELSE 3 END,
                to_date, group_id
        `).bind(userId, currentYear).all();

        // Past-25-trading-day option 收益 — counts every NYSE trading day
        // (QQQ market_prices = the authoritative open-day list); days with no
        // fills count as 0. Uses the shared helper so the per-day numbers
        // match the daily-trades chart exactly.
        //
        // Cached in daily_premium_cache keyed by (user, window-end) because the
        // ~25 generateDailyTradesText renders are CPU-heavy and were nudging
        // the worker toward Cloudflare's per-request CPU ceiling (Error 1102),
        // especially under admin/users batch generation. A past window-end is
        // immutable → cached forever; today's is re-validated against a short
        // freshness window since intraday trades can still move it.
        const CACHE_FRESH_SECONDS = 10 * 60; // re-compute today's value at most every 10 min
        let last25TradingDaysPremium: number | null = null;
        try {
            const { results: tdRows } = await db.prepare(`
                SELECT date(datetime(date, 'unixepoch')) AS d
                FROM market_prices
                WHERE symbol = 'QQQ'
                ORDER BY date DESC
                LIMIT 25
            `).all<{ d: string }>();
            const tradingDays = (tdRows || []).map(r => r.d).filter(Boolean);
            if (tradingDays.length > 0) {
                const windowStart = tradingDays[tradingDays.length - 1]; // oldest of the 25
                const windowEnd = tradingDays[0];                        // newest of the 25
                const nowSec = Math.floor(Date.now() / 1000);
                const todayStr = new Date().toISOString().substring(0, 10);

                // Cache lookup.
                let cached: { value: number; computed_at: number } | null = null;
                try {
                    cached = await db.prepare(
                        `SELECT value, computed_at FROM daily_premium_cache WHERE user_id = ? AND end_date = ?`,
                    ).bind(userId, windowEnd).first<{ value: number; computed_at: number }>();
                } catch { /* table may not exist pre-migration — fall through to compute */ }

                const isStale = !cached
                    || (windowEnd >= todayStr && (nowSec - cached.computed_at) > CACHE_FRESH_SECONDS);

                if (cached && !isStale) {
                    last25TradingDaysPremium = cached.value;
                } else {
                    const profitByDate = await computeDailyOptionProfits(
                        db,
                        { id: userId, user_id: user.user_id, name: (user as { name?: string | null }).name },
                        windowStart,
                        windowEnd,
                    );
                    // Sum over the trading-day calendar; missing day → 0.
                    last25TradingDaysPremium = tradingDays.reduce((s, d) => s + (profitByDate[d] || 0), 0);
                    // Write-through (best-effort).
                    try {
                        await db.prepare(
                            `INSERT INTO daily_premium_cache (user_id, end_date, value, computed_at)
                             VALUES (?, ?, ?, ?)
                             ON CONFLICT(user_id, end_date) DO UPDATE SET value = excluded.value, computed_at = excluded.computed_at`,
                        ).bind(userId, windowEnd, last25TradingDaysPremium, nowSec).run();
                    } catch { /* non-fatal */ }
                }
            }
        } catch (err) {
            console.warn('25-trading-day premium calc failed (non-fatal):', err);
        }

        // Open-position aggregates for the 不含浮虧 rate. The 含浮虧 rate
        // (= annualPremium) marks open positions to market via their
        // final_profit. To strip the floating loss we swap that MTM
        // contribution for the full premium received:
        //   不含浮虧 numerator = annualPremium − open_final_profit + open_premium
        // The delta (open_premium − open_final_profit) is the current
        // buy-back value, i.e. the unrealized loss being removed.
        let openTotalPremium = 0;
        let openTotalFinalProfit = 0;
        // 平倉費用 = buy-back cost (premium − final_profit) of open positions.
        // Respects the 只計入被突破 setting: when on, only breached legs
        // (CALL spot>strike / PUT spot<strike) contribute; otherwise all
        // open legs do. This is the exact amount that separates the two
        // 期權收益率 lines, so when nothing is breached they read equal.
        let breachedCloseCost = 0;
        try {
            const openAgg = await db.prepare(`
                SELECT COALESCE(SUM(premium), 0) AS prem, COALESCE(SUM(final_profit), 0) AS fp
                FROM OPTIONS
                WHERE owner_id = ? AND year = ? AND operation = 'Open'
            `).bind(userId, currentYear).first<{ prem: number; fp: number }>();
            openTotalPremium = openAgg?.prem ?? 0;
            openTotalFinalProfit = openAgg?.fp ?? 0;

            const costAgg = await db.prepare(`
                SELECT COALESCE(SUM(
                    CASE
                        WHEN ? = 0 THEN (O.premium - O.final_profit)
                        WHEN O.type = 'CALL' AND LP.close_price IS NOT NULL AND LP.close_price > O.strike_price THEN (O.premium - O.final_profit)
                        WHEN O.type = 'PUT'  AND LP.close_price IS NOT NULL AND LP.close_price < O.strike_price THEN (O.premium - O.final_profit)
                        ELSE 0
                    END
                ), 0) AS cost
                FROM OPTIONS O
                LEFT JOIN (
                    SELECT symbol, close_price FROM market_prices mp1
                    WHERE date = (SELECT MAX(date) FROM market_prices mp2 WHERE mp2.symbol = mp1.symbol)
                ) LP ON LP.symbol = O.underlying
                WHERE O.owner_id = ? AND O.year = ? AND O.operation = 'Open'
            `).bind(closeCostOnlyBreached ? 1 : 0, userId, currentYear).first<{ cost: number }>();
            breachedCloseCost = costAgg?.cost ?? 0;
        } catch (err) {
            console.warn('open-position aggregate failed (non-fatal):', err);
        }

        // 不含平倉費用 numerator = realized + interest + full open premium.
        // annualPremiumBeforeAdj = realized + interest + open mark-to-market
        // (final_profit); swap that MTM for the full premium received.
        // 含平倉費用 = 不含 − 平倉費用 (breach-aware). When nothing is
        // breached, breachedCloseCost = 0 → the two are identical.
        const premiumExCloseCost = annualPremiumBeforeAdj - openTotalFinalProfit + openTotalPremium;
        const premiumIncCloseCost = premiumExCloseCost - breachedCloseCost;

        return NextResponse.json({
            success: true,
            reportData: {
                openTotalPremium,
                openTotalFinalProfit,
                breachedCloseCost,
                premiumExCloseCost,
                premiumIncCloseCost,
                user_id: user.user_id || user.email.split('@')[0],
                year: currentYear,
                accountNetWorth,
                cost2026,
                netProfit2026,
                cashBalance,
                dailyInterest,
                marginRate,
                highestNetWorth,
                lifetimeDeposit,
                ytdReturn,
                qqqReturn,
                maxDrawdown,
                sharpeRatio,
                annualStdDev,
                stockPositions: enhancedStockPositions,
                quarterlyPremium,
                quarterlyTarget,
                annualPremium,
                premiumCostBase,
                annualTarget,
                last25TradingDaysPremium,
                openOptions: openOptions || [],
                lastUpdateDate: latestEquity?.date || null,
                startDate: user.start_date || null
            }
        });

    } catch (error) {
        console.error('Generate report error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
