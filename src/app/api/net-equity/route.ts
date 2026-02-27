import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { getMarketData } from '@/lib/market-data';
import { calculateBenchmarkStats, calculateUserTwr, findPrice } from '@/lib/twr';
import { cacheResponse, clearCache } from '@/lib/response-cache';
import { fetchFredRatesForYear, calculateDailyInterest } from '@/lib/fred';

export const dynamic = 'force-dynamic';



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
        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        // Authorization: Admin/Manager can see any, Customer can only see self
        let targetUserId: number | null = user.id;
        let isBulkFetch = false;

        if (userIdParam) {
            // Check if userIdParam is numeric ID or string user_id
            let numericId = parseInt(userIdParam);

            // If NaN, it might be a user_id string (e.g. 'derren')
            if (isNaN(numericId)) {
                // Look up user by user_id string to get the numeric ID
                // Respect the requested year to ensure we get the correct user entity (e.g. scott 2025 vs scott 2026)
                const userRecord = await db.prepare('SELECT id FROM USERS WHERE (user_id = ? OR email = ?) AND year = ?')
                    .bind(userIdParam, userIdParam, year)
                    .first();
                if (userRecord) {
                    numericId = userRecord.id;
                }
            }

            if (['admin', 'manager'].includes(user.role)) {
                if (!isNaN(numericId)) {
                    targetUserId = numericId;
                } else {
                    // Could not resolve user
                    return NextResponse.json({ success: true, data: [] });
                }
            } else if (numericId !== user.id) {
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





        if (isBulkFetch) {
            // Bulk Logic - Wrap in cache to avoid expensive TWR calculations
            const cacheKey = `net-equity-bulk-${group}-${year}-v4`;
            const userSummaries = await cacheResponse(cacheKey, async () => {
                const equityRecords = await db.prepare(`SELECT * FROM DAILY_NET_EQUITY WHERE year = ? ORDER BY user_id, date ASC`).bind(year).all();

                // Legacy DEPOSITS table query removed. We now use DAILY_NET_EQUITY.deposit

                const users = await db.prepare(`SELECT id, user_id, email, initial_cost FROM USERS WHERE role = 'customer' AND year = ?`).bind(year).all();

                // Fetch stock holdings for all users
                const stockHoldingsQuery = await db.prepare(`
                    SELECT owner_id, symbol, SUM(quantity) as total_quantity
                    FROM STOCK_TRADES
                    WHERE year = ? AND status = 'Open'
                    GROUP BY owner_id, symbol
                    HAVING total_quantity > 0
                    ORDER BY owner_id, total_quantity DESC
                `).bind(year).all();

                // Fetch open PUT covered capital for margin calculation
                const putCapitalQuery = await db.prepare(`
                    SELECT owner_id, COALESCE(SUM(ABS(quantity) * strike_price * 100), 0) as open_put_covered_capital
                    FROM OPTIONS
                    WHERE year = ? AND operation = 'Open' AND type = 'PUT'
                    GROUP BY owner_id
                `).bind(year).all();

                const putCapitalByUser = new Map<number, number>();
                for (const row of (putCapitalQuery.results as any[])) {
                    putCapitalByUser.set(row.owner_id, row.open_put_covered_capital);
                }

                // Group holdings by user_id
                const holdingsByUser = new Map<number, Array<{ symbol: string, quantity: number }>>();
                for (const holding of (stockHoldingsQuery.results as any[])) {
                    if (!holdingsByUser.has(holding.owner_id)) {
                        holdingsByUser.set(holding.owner_id, []);
                    }
                    holdingsByUser.get(holding.owner_id)!.push({
                        symbol: holding.symbol,
                        quantity: holding.total_quantity
                    });
                }

                // Fetch FRED rate map for the year (for daily interest calculation)
                let fredRateMap: Record<string, number> = {};
                try {
                    fredRateMap = await fetchFredRatesForYear(year);
                } catch (err) {
                    console.warn('Failed to fetch FRED rates for bulk:', err);
                }

                return (users.results as any[]).map(u => {
                    const uEq = (equityRecords.results as any[]).filter(r => r.user_id === u.id);

                    // Synthesize Deposit[] from uEq.deposit
                    const uDep = uEq.filter(r => r.deposit && r.deposit !== 0).map(r => ({
                        deposit_date: r.date,
                        amount: Math.abs(r.deposit),
                        transaction_type: r.deposit > 0 ? 'deposit' : 'withdrawal'
                    }));

                    // Get top 3 holdings for this user
                    const userHoldings = holdingsByUser.get(u.id) || [];

                    // Custom sort: QQQ first, QLD second, TQQQ third, others by quantity
                    const priorityOrder: Record<string, number> = { 'QQQ': 0, 'QLD': 1, 'TQQQ': 2 };
                    const sortedHoldings = userHoldings.sort((a, b) => {
                        const pa = priorityOrder[a.symbol] ?? 999;
                        const pb = priorityOrder[b.symbol] ?? 999;
                        if (pa !== pb) return pa - pb;
                        // For other symbols, sort by quantity descending
                        return b.quantity - a.quantity;
                    });

                    const topHoldings = sortedHoldings;

                    // Determine Benchmark Start Date (Previous Year Dec 31 if year selected)
                    const benchStartDate = (year && !isNaN(year)) ? prevYearDec31 : (uEq.length > 0 ? uEq[0].date : undefined);

                    // Use Shared Helper
                    const processed = calculateUserTwr(uEq, uDep, (u as any).initial_cost, benchStartDate || 0, qqqData, qldData);

                    const lastDate = uEq.length > 0 ? uEq[uEq.length - 1].date : 0;

                    const qqqStats = uEq.length > 0 ? calculateBenchmarkStats(qqqData, benchStartDate || (uEq[0].date), lastDate, (u as any).initial_cost, uDep) : null;
                    const qldStats = uEq.length > 0 ? calculateBenchmarkStats(qldData, benchStartDate || (uEq[0].date), lastDate, (u as any).initial_cost, uDep) : null;

                    const latestRecord = uEq.length > 0 ? uEq[uEq.length - 1] : null;
                    const currentCashBalance = latestRecord ? (latestRecord.cash_balance ?? 0) : 0;

                    // Calculate total daily interest (with weekend/holiday gap logic)
                    let totalDailyInterest = 0;
                    for (let i = 0; i < uEq.length; i++) {
                        const row = uEq[i];
                        const todayInterest = calculateDailyInterest(row.cash_balance ?? 0, row.date, fredRateMap);
                        let recordInterest = todayInterest;
                        if (i > 0) {
                            const prevDate = uEq[i - 1].date as number;
                            const gapDays = Math.round((row.date - prevDate) / 86400);
                            if (gapDays > 1) {
                                const prevDayInterest = calculateDailyInterest(uEq[i - 1].cash_balance ?? 0, prevDate, fredRateMap);
                                recordInterest = prevDayInterest * (gapDays - 1) + todayInterest;
                            }
                        }
                        totalDailyInterest += recordInterest;
                    }

                    const total_deposit = uEq.reduce((acc: number, r: any) => acc + (r.deposit || 0), 0);
                    return {
                        ...u,
                        ...processed.summary, // Merges stats, current_net_equity, equity_history
                        current_cash_balance: currentCashBalance,
                        open_put_covered_capital: putCapitalByUser.get(u.id) || 0,
                        total_deposit,
                        total_daily_interest: totalDailyInterest,
                        top_holdings: topHoldings,
                        qqqStats,
                        qldStats
                    };
                });
            }, 5 * 60 * 1000); // 5 minute cache

            return NextResponse.json({ success: true, data: userSummaries });

        } else {
            // Single User Logic
            const equityRecords = await db.prepare(`
                SELECT * FROM DAILY_NET_EQUITY 
            WHERE user_id = ? AND year = ?
            ORDER BY date ASC
        `).bind(targetUserId, year).all();

            // Legacy DEPOSITS table query removed.

            const userRecord = await db.prepare('SELECT initial_cost, user_id, email FROM USERS WHERE id = ?').bind(targetUserId).first();

            // Cast to generic object to pass to helper
            const u = {
                id: targetUserId,
                initial_cost: (userRecord?.initial_cost as number) || 0,
                user_id: userRecord?.user_id,
                email: userRecord?.email
            };

            // Re-run loop for Single User to get exact shape text:
            const uEq = equityRecords.results as any[];

            // Fetch FRED rate map for the year (for daily interest calculation)
            let fredRateMap: Record<string, number> = {};
            try {
                fredRateMap = await fetchFredRatesForYear(year);
            } catch (err) {
                console.warn('Failed to fetch FRED rates, daily interest will be 0:', err);
            }

            const rows = uEq;
            const singleResultData: any[] = [];
            let prevNavRatio = 1.0;
            let prevEquity = (u as any).initial_cost || 0;
            let peakNavRatio = 1.0;

            // Start Price for Benchmarks
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

                // Direct read from row.deposit instead of Map
                const dailyDeposit = row.deposit || 0;

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
                const dateObj = new Date(date * 1000);
                const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;

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

                // Calculate estimated daily IB margin interest using FRED rate
                const todayInterest = calculateDailyInterest(
                    row.cash_balance ?? 0,
                    row.date,
                    fredRateMap
                );

                // Account for weekend/holiday gaps:
                // If there's a gap between this record and the previous one,
                // the missing days used the previous record's cash balance (and thus its rate).
                // e.g. Monday = Friday_rate × 2 (Sat+Sun) + Monday_rate
                let dailyInterest = todayInterest;
                if (i > 0) {
                    const prevDate = rows[i - 1].date as number;
                    const gapDays = Math.round((row.date - prevDate) / 86400); // seconds in a day
                    if (gapDays > 1) {
                        const prevDayInterest = calculateDailyInterest(
                            rows[i - 1].cash_balance ?? 0,
                            prevDate,
                            fredRateMap
                        );
                        dailyInterest = prevDayInterest * (gapDays - 1) + todayInterest;
                    }
                }

                singleResultData.push({
                    id: row.id,
                    date: row.date,
                    net_equity: equity,
                    cash_balance: row.cash_balance ?? null,
                    // Use deposit column
                    deposit: dailyDeposit,
                    // Keeping daily_deposit for compatibility if frontend needs it, but it's redundant
                    daily_deposit: dailyDeposit,
                    daily_return: dailyReturn,
                    nav_ratio: navRatio,
                    running_peak: peakNavRatio,
                    drawdown: drawdown,
                    is_new_high: isNewHigh,
                    rate: (navRatio - 1) * 100,
                    qqq_rate: qqqRate,
                    qld_rate: qldRate,
                    management_fee: row.management_fee ?? 0,
                    interest: row.interest ?? 0,
                    daily_interest: dailyInterest,
                    exposure_adjustment: row.exposure_adjustment ?? 'none'
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
        const { user_id, date, net_equity, cash_balance, deposit, management_fee, interest, year, exposure_adjustment } = body;

        if (!user_id || !date || net_equity === undefined) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        let targetYear = year;
        if (!targetYear) {
            const dateObj = new Date(date * 1000);
            targetYear = dateObj.getFullYear();
        }

        const depositVal = deposit || 0;
        const feeVal = management_fee || 0;
        const interestVal = interest || 0;
        const exposureVal = exposure_adjustment || 'none';

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const result = await db.prepare(`
        INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, deposit, management_fee, interest, year, exposure_adjustment, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id, date) DO UPDATE SET
        net_equity = excluded.net_equity,
        cash_balance = excluded.cash_balance,
        deposit = excluded.deposit,
        management_fee = excluded.management_fee,
        interest = excluded.interest,
        year = excluded.year,
        exposure_adjustment = excluded.exposure_adjustment,
        updated_at = unixepoch()
    `).bind(user_id, date, net_equity, cash_balance, depositVal, feeVal, interestVal, targetYear, exposureVal).run();

        // Clear cache to ensure fresh data on next fetch
        clearCache();

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
        const { id, date, net_equity, cash_balance, deposit, management_fee, interest, exposure_adjustment } = body;

        if (!id || !date || net_equity === undefined) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        const depositVal = deposit ?? 0;
        const feeVal = management_fee ?? 0;
        const interestVal = interest ?? 0;
        const exposureVal = exposure_adjustment ?? 'none';

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const result = await db.prepare(`
        UPDATE DAILY_NET_EQUITY 
        SET date = ?, net_equity = ?, cash_balance = ?, deposit = ?, management_fee = ?, interest = ?, exposure_adjustment = ?, updated_at = unixepoch()
        WHERE id = ?
    `).bind(date, net_equity, cash_balance, depositVal, feeVal, interestVal, exposureVal, id).run();

        if (result.meta.changes === 0) {
            return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
        }

        // Clear cache to ensure fresh data on next fetch
        clearCache();

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
        const { id, mode, user_id, year, delete_benchmarks } = body;

        // Mode: 'single' (default) or 'all'
        const isBulk = mode === 'all';

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        if (isBulk) {
            if (!user_id || !year) {
                return NextResponse.json({ error: 'Missing user_id or year for bulk delete' }, { status: 400 });
            }

            // 1. Delete Net Equity Records ONLY
            // Unlike previous version, we DO NOT delete market data (QQQ/QLD) as that is global data shared across users.
            const deleteResult = await db.prepare(`DELETE FROM DAILY_NET_EQUITY WHERE user_id = ? AND year = ?`).bind(user_id, year).run();

            // 2. Reset year-start fields to 0
            await db.prepare(`
                UPDATE USERS SET
                    initial_cost = 0,
                    initial_cash = 0,
                    initial_management_fee = 0,
                    initial_deposit = 0,
                    updated_at = unixepoch()
                WHERE id = ?
            `).bind(user_id).run();

            // Clear cache to ensure fresh data on next fetch
            clearCache();

            return NextResponse.json({ success: true, deleted: deleteResult.meta.changes });

        } else {
            // Single Record Delete
            if (!id) {
                return NextResponse.json({ error: 'Missing id' }, { status: 400 });
            }
            const result = await db.prepare(`DELETE FROM DAILY_NET_EQUITY WHERE id = ?`).bind(id).run();
            if (result.meta.changes === 0) {
                return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
            }

            // Clear cache to ensure fresh data on next fetch
            clearCache();

            return NextResponse.json({ success: true });
        }

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
