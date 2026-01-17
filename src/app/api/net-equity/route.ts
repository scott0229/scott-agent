import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { getMarketData } from '@/lib/market-data';

export const dynamic = 'force-dynamic';

// Helper to calculate stats for a price series
const calculateBenchmarkStats = (prices: any[], startDate: number, endDate: number, initialCost: number, deposits: any[]) => {
    if (!prices || prices.length === 0) return null;

    // Filter prices from startDate to endDate
    const relevantPrices = prices.filter(p => p.date >= startDate && p.date <= endDate);
    if (relevantPrices.length < 2) return null;

    // Map Deposits
    const depositMap = new Map<number, number>();
    deposits.forEach(d => {
        const dateObj = new Date(d.deposit_date * 1000);
        // Midnight UTC to match market data
        const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
        const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
        depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
    });

    const startPrice = relevantPrices[0].close;
    let shares = initialCost / startPrice;
    let prevEquity = initialCost;
    let prevNavRatio = 1.0;

    // Max Drawdown & New Highs (NAV Based)
    let peak = 1.0;
    let maxDd = 0;
    let newHighCount = 0;
    const dailyRets: number[] = [];

    relevantPrices.forEach((p, idx) => {
        const price = p.close;
        const date = p.date;
        const dailyDeposit = depositMap.get(date) || 0;

        // Buy shares at CLOSE
        if (dailyDeposit !== 0 && price > 0) {
            shares += dailyDeposit / price;
        }

        const currentEquity = shares * price;
        let dailyReturn = 0;

        if (idx > 0) {
            const startVal = prevEquity;
            // Formula matching Account Logic: (End - Dep - Start) / (Start + Dep)
            if (startVal + dailyDeposit !== 0) {
                dailyReturn = (currentEquity - dailyDeposit - startVal) / (startVal + dailyDeposit);
            }
        }

        dailyRets.push(dailyReturn);

        // Update NAV
        if (idx === 0) {
            prevNavRatio = 1.0;
        } else {
            prevNavRatio = prevNavRatio * (1 + dailyReturn);
        }

        // Stats
        if (prevNavRatio > peak) {
            peak = prevNavRatio;
            if (idx > 0) newHighCount++;
        }
        const dd = (prevNavRatio - peak) / peak;
        if (dd < maxDd) maxDd = dd;

        prevEquity = currentEquity;
    });

    const avgDaily = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
    const annRet = avgDaily * 252; // Simple assumption, or compound? Account implementation uses compound for total rate, but avg daily for Sharpe?
    // Actually, Account Annualized Return = (1+TotalRet)^(1/Y) - 1 usually. 
    // Checking lines 322 in original: `annualizedReturn = avgDailyReturn * 252`. Yes, simple approximation used there.

    const variance = dailyRets.reduce((a, b) => a + Math.pow(b - avgDaily, 2), 0) / (dailyRets.length - 1);
    const stdDev = Math.sqrt(variance);
    const annStdDev = stdDev * Math.sqrt(252);
    const sharpe = annStdDev !== 0 ? (annRet - 0.04) / annStdDev : 0;

    // New High Freq
    const daySpan = relevantPrices.length;
    const newHighFreq = daySpan > 0 ? newHighCount / daySpan : 0;

    return {
        startEquity: initialCost,
        currentEquity: prevEquity,
        returnPercentage: prevNavRatio - 1, // TWR
        maxDrawdown: maxDd,
        annualizedReturn: annRet,
        annualizedStdDev: annStdDev,
        sharpeRatio: sharpe,
        newHighCount,
        newHighFreq
    };
};

export async function GET(request: NextRequest) {
    try {
        // Auth check
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const userIdParam = searchParams.get('userId');
        const yearParam = searchParams.get('year');
        const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();

        // Authorization: Admin/Manager can see any, Customer can only see self
        let targetUserId: number | null = user.id;
        let isBulkFetch = false;

        if (userIdParam) {
            if (['admin', 'manager'].includes(user.role)) {
                targetUserId = parseInt(userIdParam);
            } else if (parseInt(userIdParam) !== user.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        } else {
            // No userId param
            if (['admin', 'manager'].includes(user.role)) {
                // Admin asking for all data
                targetUserId = null;
                isBulkFetch = true;
            } else {
                // Customer defaults to self
                targetUserId = user.id;
            }
        }

        const db = await getDb();

        // 1. Fetch Market Data for the Year (Common for both paths)
        // 1. Fetch Market Data for the Year (Common for both paths)
        const startOfYear = new Date(Date.UTC(year, 0, 1)).getTime() / 1000;
        const prevYearDec31 = new Date(Date.UTC(year - 1, 11, 31)).getTime() / 1000;
        const endOfYear = Math.floor(Date.now() / 1000);

        // Fetch Benchmark Data (QQQ, QLD) safely
        let qqqData: any[] = [];
        let qldData: any[] = [];
        try {
            // We fetch a bit extra history (e.g. from previous year end) to ensure we find a "start price" 
            const [qData, lData] = await Promise.all([
                getMarketData('QQQ', startOfYear - 86400 * 5, endOfYear),
                getMarketData('QLD', startOfYear - 86400 * 5, endOfYear)
            ]);
            qqqData = qData;
            qldData = lData;
        } catch (error) {
            console.error('Failed to fetch benchmark data:', error);
            // Continue without benchmarks
        }

        // Helper to find closest price
        const findPrice = (data: any[], targetDate: number) => {
            // Data is expected to be sorted by date ASC (getMarketData does this typically? we should ensure)
            // We want the last record where date <= targetDate
            // Simple linear scan backwards or map approach
            // Since we iterate forward through user records, we can track index?
            // For simplicity, let's just find.
            // Optimized: Create a map of "Date Midnight" -> Price? 
            // Issue: User date might not be exact midnight or might be Sunday.
            // Let's filter candidates <= targetDate and take the last one.

            // Optimization: sort data if not sorted.
            // market-data.ts likely returns sorted.

            let closest = null;
            // Iterate backwards
            for (let i = data.length - 1; i >= 0; i--) {
                if (data[i].date <= targetDate + 86400) { // Allow same day (within 24h?)
                    // Be careful with timestamps.
                    // If targetDate is Jan 6 00:00 UTC.
                    // Market Data date is Jan 6 00:00 UTC.
                    // comparison <= works.
                    // If targetDate is Jan 6 23:59.
                    // Market Data <= works.
                    // If Market Data is Jan 5.
                    // We want Jan 6 if avail, else Jan 5.
                    if (data[i].date <= targetDate) {
                        closest = data[i].close;
                        break;
                    }
                }
            }
            return closest;
        };

        const processUserRecords = (u: any, uEq: any[], uDep: any[], benchStartDate?: number) => {
            let chartData: { date: number; net_equity: number; rate: number; qqq_rate?: number; qld_rate?: number }[] = [];

            if (uEq.length === 0) {
                // No user data: Generate YTD chart but with 0 values (User request: "No lines or 0")
                if (qqqData.length > 0) {
                    qqqData.forEach(day => {
                        chartData.push({
                            date: day.date,
                            net_equity: (u as any).initial_cost || 0,
                            rate: 0
                            // Omitted qqq_rate / qld_rate to prevent drawing lines
                        });
                    });
                }

                return {
                    summary: {
                        ...u,
                        current_net_equity: (u as any).initial_cost || 0,
                        stats: null,
                        equity_history: chartData
                    },
                    dailyReturns: []
                };
            }
            // Map Deposits
            const depositMap = new Map<number, number>();
            uDep.forEach(d => {
                const dateObj = new Date(d.deposit_date * 1000);
                const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
                const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
                depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
            });

            let prevNavRatio = 1.0;
            let prevEquity = (u as any).initial_cost || 0;
            let peakNavRatio = 1.0;
            let minDrawdown = 0;
            let newHighCount = 0;
            let dailyReturns: number[] = [];


            // Determine Start Price from Market Data
            // We want the price on the day of the FIRST record (or closest previous).
            // This is our "0%" baseline.
            let startQQQ = 0;
            let startQLD = 0;

            if (uEq.length > 0) {
                const firstDate = uEq[0].date;
                const dateObj = new Date(firstDate * 1000);
                const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;

                // Use midnight for lookup to match market data convention generally
                const referenceDate = benchStartDate || firstDate;
                // Wait, if benchStartDate is Dec 31, we need to price at Dec 31.
                // If finding price using `findPrice` which returns "last price <= date".

                // If benchStartDate provided, use it. Else use firstDate.
                const targetStart = benchStartDate ? benchStartDate : firstDate;

                startQQQ = findPrice(qqqData, targetStart) || 0;
                startQLD = findPrice(qldData, targetStart) || 0;
            }

            // Benchmark Running State for TWR
            let qqqShares = startQQQ > 0 ? ((u as any).initial_cost || 0) / startQQQ : 0;
            let qldShares = startQLD > 0 ? ((u as any).initial_cost || 0) / startQLD : 0;

            let prevQQQEquity = (u as any).initial_cost || 0;
            let prevQLDEquity = (u as any).initial_cost || 0;

            let prevQQQNav = 1.0;
            let prevQLDNav = 1.0;

            uEq.forEach((row, i) => {
                const date = row.date;
                const equity = row.net_equity;
                const dateObj = new Date(date * 1000);
                const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
                const dailyDeposit = depositMap.get(midnight) || 0;

                let dailyReturn = 0;
                // Calculate daily return
                if (prevEquity + dailyDeposit !== 0) {
                    dailyReturn = (equity - dailyDeposit - prevEquity) / (prevEquity + dailyDeposit);
                }

                dailyReturns.push(dailyReturn);
                const navRatio = prevNavRatio * (1 + dailyReturn);

                // Benchmark Rates (TWR Calculation)
                const qqqPrice = findPrice(qqqData, midnight) || 0;
                const qldPrice = findPrice(qldData, midnight) || 0;

                let qqqRate = undefined;
                let qldRate = undefined;

                // QQQ TWR Logic
                if (startQQQ > 0 && qqqPrice > 0) {
                    // Buy shares with deposit
                    if (dailyDeposit !== 0) {
                        qqqShares += dailyDeposit / qqqPrice;
                    }
                    const currQQQEquity = qqqShares * qqqPrice;
                    let dailyQQQRet = 0;
                    if (prevQQQEquity + dailyDeposit !== 0) {
                        dailyQQQRet = (currQQQEquity - dailyDeposit - prevQQQEquity) / (prevQQQEquity + dailyDeposit);
                    }
                    // Update NAV
                    prevQQQNav = (i === 0 ? 1.0 : prevQQQNav) * (1 + dailyQQQRet);
                    qqqRate = (prevQQQNav - 1) * 100;
                    prevQQQEquity = currQQQEquity;
                }

                // QLD TWR Logic
                if (startQLD > 0 && qldPrice > 0) {
                    // Buy shares with deposit
                    if (dailyDeposit !== 0) {
                        qldShares += dailyDeposit / qldPrice;
                    }
                    const currQLDEquity = qldShares * qldPrice;
                    let dailyQLDRet = 0;
                    if (prevQLDEquity + dailyDeposit !== 0) {
                        dailyQLDRet = (currQLDEquity - dailyDeposit - prevQLDEquity) / (prevQLDEquity + dailyDeposit);
                    }
                    // Update NAV
                    prevQLDNav = (i === 0 ? 1.0 : prevQLDNav) * (1 + dailyQLDRet);
                    qldRate = (prevQLDNav - 1) * 100;
                    prevQLDEquity = currQLDEquity;
                }

                chartData.push({
                    date: date,
                    net_equity: equity,
                    rate: (navRatio - 1) * 100,
                    qqq_rate: qqqRate,
                    qld_rate: qldRate
                });

                if (navRatio > peakNavRatio) {
                    peakNavRatio = navRatio;
                    newHighCount++;
                }

                const dd = (navRatio - peakNavRatio) / peakNavRatio;
                if (dd < minDrawdown) minDrawdown = dd;

                prevNavRatio = navRatio;
                prevEquity = equity;
            });

            // Calculate Monthly Stats (omitted/simplified for single user response if not needed, but needed for BULK)
            // ... (We keep the monthly logic for Bulk, but maybe skip for Single if not requested? 
            // Actually single user request below returns `resultData` (flat array), not `UserSummary`.
            // We should ensure consistency, but let's stick to returning what each endpoint expects.

            return {
                summary: {
                    ...u,
                    initial_cost: (u as any).initial_cost || 0,
                    current_net_equity: uEq.length > 0 ? uEq[uEq.length - 1].net_equity : ((u as any).initial_cost || 0),
                    stats: {
                        startDate: uEq[0].date,
                        returnPercentage: prevNavRatio - 1,
                        maxDrawdown: minDrawdown,
                        // ... other stats
                        annualizedReturn: 0, // Placeholder if not needed for chart
                        annualizedStdDev: 0,
                        sharpeRatio: 0,
                        newHighCount: newHighCount,
                        newHighFreq: 0
                    },
                    equity_history: chartData
                },
                // For bulk, we need full stats.
                dailyReturns // Pass out if needed for calcs
            };
        };


        if (isBulkFetch) {
            // Bulk Logic
            const equityRecords = await db.prepare(`SELECT * FROM DAILY_NET_EQUITY WHERE year = ? ORDER BY user_id, date ASC`).bind(year).all();
            const deposits = await db.prepare(`SELECT * FROM DEPOSITS ORDER BY user_id, deposit_date ASC`).all();
            const users = await db.prepare(`SELECT id, user_id, email, initial_cost FROM USERS WHERE role = 'customer'`).all();

            const userSummaries = (users.results as any[]).map(u => {
                const uEq = (equityRecords.results as any[]).filter(r => r.user_id === u.id);
                const uDep = (deposits.results as any[]).filter(d => d.user_id === u.id);

                // Determine Benchmark Start Date (Previous Year Dec 31 if year selected)
                const benchStartDate = (year && !isNaN(year)) ? prevYearDec31 : (uEq.length > 0 ? uEq[0].date : undefined);

                const processed = processUserRecords(u, uEq, uDep, benchStartDate);

                // Re-calculate advanced stats for Bulk (which uses them)
                const dailyReturns = processed.dailyReturns;
                const daySpan = uEq.length;

                const avgDailyReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a: number, b: number) => a + b, 0) / dailyReturns.length : 0;
                const annualizedReturn = avgDailyReturn * 252;

                let annualizedStdDev = 0;
                if (dailyReturns.length > 0) {
                    const mean = avgDailyReturn;
                    const variance = dailyReturns.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / (dailyReturns.length - 1);
                    const stdDev = Math.sqrt(variance);
                    annualizedStdDev = stdDev * Math.sqrt(252);
                }
                const sharpe = annualizedStdDev !== 0 ? (annualizedReturn - 0.04) / annualizedStdDev : 0;



                const lastDate = uEq.length > 0 ? uEq[uEq.length - 1].date : 0;
                // Use previously calculated benchStartDate
                // const benchStartDate = ... (removed duplicate)

                const qqqStats = uEq.length > 0 ? calculateBenchmarkStats(qqqData, benchStartDate, lastDate, (u as any).initial_cost, uDep) : null;
                const qldStats = uEq.length > 0 ? calculateBenchmarkStats(qldData, benchStartDate, lastDate, (u as any).initial_cost, uDep) : null;

                return {
                    ...processed.summary,
                    stats: {
                        ...processed.summary.stats,
                        annualizedReturn,
                        annualizedStdDev,
                        sharpeRatio: sharpe,
                        newHighFreq: daySpan > 0 ? processed.summary.stats.newHighCount / daySpan : 0
                    },
                    qqqStats,
                    qldStats
                };
            });

            return NextResponse.json({ success: true, data: userSummaries });

        } else {
            // Single User Logic
            const equityRecords = await db.prepare(`
                SELECT * FROM DAILY_NET_EQUITY 
                WHERE user_id = ? AND year = ?
                ORDER BY date ASC
            `).bind(targetUserId, year).all();

            const deposits = await db.prepare(`
                SELECT * FROM DEPOSITS 
                WHERE user_id = ? 
                ORDER BY deposit_date ASC
            `).bind(targetUserId).all();

            const userRecord = await db.prepare('SELECT initial_cost, user_id, email FROM USERS WHERE id = ?').bind(targetUserId).first();

            // Cast to generic object to pass to helper
            const u = {
                id: targetUserId,
                initial_cost: (userRecord?.initial_cost as number) || 0,
                user_id: userRecord?.user_id,
                email: userRecord?.email
            };

            // The Single User endpoint returns a flat list of records (PerformanceRecord[]), reversed.
            // We re-run the loop to ensure we return the exact structure expected by the frontend,
            // while adding the new benchmark keys (qqq_rate, qld_rate).

            // Re-run loop for Single User to get exact shape text:
            // (Copying logic from helper but adapting output)

            const uEq = equityRecords.results as any[];
            const uDep = deposits.results as any[];

            // ... Deposit Map ...
            const depositMap = new Map<number, number>();
            uDep.forEach(d => {
                const dateObj = new Date(d.deposit_date * 1000);
                const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
                const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
                depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
            });

            const rows = uEq;
            const singleResultData: any[] = [];
            let prevNavRatio = 1.0;
            let prevEquity = (u as any).initial_cost || 0;
            let peakNavRatio = 1.0;

            // Start Price for Benchmarks
            // Determine Benchmark Start Date for Single User
            const benchStartDate = (year && !isNaN(year)) ? prevYearDec31 : uEq[0].date;

            // Start Price for Benchmarks
            let startQQQ = 0;
            let startQLD = 0;
            if (uEq.length > 0) {
                // Use benchStartDate or firstDate
                const targetStart = benchStartDate || uEq[0].date;
                startQQQ = findPrice(qqqData, targetStart) || 0;
                startQLD = findPrice(qldData, targetStart) || 0;
            }

            // Benchmark Running State for TWR
            let qqqShares = startQQQ > 0 ? ((u as any).initial_cost || 0) / startQQQ : 0;
            let qldShares = startQLD > 0 ? ((u as any).initial_cost || 0) / startQLD : 0;

            let prevQQQEquity = (u as any).initial_cost || 0;
            let prevQLDEquity = (u as any).initial_cost || 0;

            let prevQQQNav = 1.0;
            let prevQLDNav = 1.0;

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const date = row.date;
                const equity = row.net_equity;
                const dateObj = new Date(date * 1000);
                const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
                const dailyDeposit = depositMap.get(midnight) || 0;

                let dailyReturn = 0;
                if (prevEquity + dailyDeposit !== 0) {
                    dailyReturn = (equity - dailyDeposit - prevEquity) / (prevEquity + dailyDeposit);
                }

                const navRatio = prevNavRatio * (1 + dailyReturn);
                let isNewHigh = false;
                if (navRatio > peakNavRatio) {
                    peakNavRatio = navRatio;
                    isNewHigh = true;
                }
                const drawdown = (navRatio - peakNavRatio) / peakNavRatio;

                // Benchmarks Rates (TWR Calculation)
                const qqqPrice = findPrice(qqqData, midnight) || 0;
                const qldPrice = findPrice(qldData, midnight) || 0;
                let qqqRate = undefined;
                let qldRate = undefined;

                // QQQ TWR Logic
                if (startQQQ > 0 && qqqPrice > 0) {
                    if (dailyDeposit !== 0) qqqShares += dailyDeposit / qqqPrice;
                    const currQQQEquity = qqqShares * qqqPrice;
                    let dailyQQQRet = 0;
                    if (prevQQQEquity + dailyDeposit !== 0) dailyQQQRet = (currQQQEquity - dailyDeposit - prevQQQEquity) / (prevQQQEquity + dailyDeposit);
                    prevQQQNav = (i === 0 ? 1.0 : prevQQQNav) * (1 + dailyQQQRet);
                    qqqRate = (prevQQQNav - 1) * 100;
                    prevQQQEquity = currQQQEquity;
                }

                // QLD TWR Logic
                if (startQLD > 0 && qldPrice > 0) {
                    if (dailyDeposit !== 0) qldShares += dailyDeposit / qldPrice;
                    const currQLDEquity = qldShares * qldPrice;
                    let dailyQLDRet = 0;
                    if (prevQLDEquity + dailyDeposit !== 0) dailyQLDRet = (currQLDEquity - dailyDeposit - prevQLDEquity) / (prevQLDEquity + dailyDeposit);
                    prevQLDNav = (i === 0 ? 1.0 : prevQLDNav) * (1 + dailyQLDRet);
                    qldRate = (prevQLDNav - 1) * 100;
                    prevQLDEquity = currQLDEquity;
                }

                singleResultData.push({
                    id: row.id,
                    date: row.date,
                    net_equity: equity,
                    daily_deposit: dailyDeposit,
                    daily_return: dailyReturn,
                    nav_ratio: navRatio,
                    running_peak: peakNavRatio,
                    drawdown: drawdown,
                    is_new_high: isNewHigh,
                    // Additional fields for Chart
                    rate: (navRatio - 1) * 100, // Frontend uses this or calculates it? 
                    // Frontend table uses daily_return and nav_ratio. 
                    // Chart component uses `rate` (TWR).
                    // We should pass `rate` implicitly or explicitly.
                    // The Chart component accepts `data` prop. 
                    // In `NetEquityDetailPage`, `NetEquityChart` is NOT used? 
                    // Wait, let me check `NetEquityPage` (Detail) again.
                    qqq_rate: qqqRate,
                    qld_rate: qldRate
                });

                prevEquity = equity;
                prevNavRatio = navRatio;
            }

            return NextResponse.json({
                success: true,
                data: singleResultData.reverse()
            });
        }

    } catch (error: any) {
        console.error('Net Equity API Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { user_id, date, net_equity, year } = body;

        if (!user_id || !date || net_equity === undefined) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        let targetYear = year;
        if (!targetYear) {
            const dateObj = new Date(date * 1000);
            targetYear = dateObj.getFullYear();
        }

        const db = await getDb();
        const result = await db.prepare(`
            INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, year, updated_at)
            VALUES (?, ?, ?, ?, unixepoch())
            ON CONFLICT(user_id, date) DO UPDATE SET
            net_equity = excluded.net_equity,
            year = excluded.year,
            updated_at = unixepoch()
        `).bind(user_id, date, net_equity, targetYear).run();

        return NextResponse.json({ success: true, id: result.meta.last_row_id });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { id, date, net_equity } = body;

        if (!id || !date || net_equity === undefined) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        const db = await getDb();
        const result = await db.prepare(`
            UPDATE DAILY_NET_EQUITY 
            SET date = ?, net_equity = ?, updated_at = unixepoch()
            WHERE id = ?
        `).bind(date, net_equity, id).run();

        if (result.meta.changes === 0) {
            return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { id } = body;

        if (!id) {
            return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        }

        const db = await getDb();
        const result = await db.prepare(`DELETE FROM DAILY_NET_EQUITY WHERE id = ?`).bind(id).run();

        if (result.meta.changes === 0) {
            return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
