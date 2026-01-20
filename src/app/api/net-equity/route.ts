import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { getMarketData } from '@/lib/market-data';
import { calculateBenchmarkStats, calculateUserTwr, findPrice } from '@/lib/twr';
import { cacheResponse } from '@/lib/response-cache';

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




        if (isBulkFetch) {
            // Bulk Logic - Wrap in cache to avoid expensive TWR calculations
            const cacheKey = `net-equity-bulk-${year}`;
            const userSummaries = await cacheResponse(cacheKey, async () => {
                const db = await getDb();
                const equityRecords = await db.prepare(`SELECT * FROM DAILY_NET_EQUITY WHERE year = ? ORDER BY user_id, date ASC`).bind(year).all();
                const deposits = await db.prepare(`SELECT * FROM DEPOSITS ORDER BY user_id, deposit_date ASC`).all();
                const users = await db.prepare(`SELECT id, user_id, email, initial_cost FROM USERS WHERE role = 'customer' AND year = ?`).bind(year).all();

                return (users.results as any[]).map(u => {
                    const uEq = (equityRecords.results as any[]).filter(r => r.user_id === u.id);
                    const uDep = (deposits.results as any[]).filter(d => d.user_id === u.id);

                    // Determine Benchmark Start Date (Previous Year Dec 31 if year selected)
                    const benchStartDate = (year && !isNaN(year)) ? prevYearDec31 : (uEq.length > 0 ? uEq[0].date : undefined);

                    // Use Shared Helper
                    const processed = calculateUserTwr(uEq, uDep, (u as any).initial_cost, benchStartDate || 0, qqqData, qldData);

                    const lastDate = uEq.length > 0 ? uEq[uEq.length - 1].date : 0;

                    const qqqStats = uEq.length > 0 ? calculateBenchmarkStats(qqqData, benchStartDate || (uEq[0].date), lastDate, (u as any).initial_cost, uDep) : null;
                    const qldStats = uEq.length > 0 ? calculateBenchmarkStats(qldData, benchStartDate || (uEq[0].date), lastDate, (u as any).initial_cost, uDep) : null;

                    const latestRecord = uEq.length > 0 ? uEq[uEq.length - 1] : null;
                    const currentCashBalance = latestRecord ? (latestRecord.cash_balance ?? 0) : 0;

                    return {
                        ...u,
                        ...processed.summary, // Merges stats, current_net_equity, equity_history
                        current_cash_balance: currentCashBalance,
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
                    cash_balance: row.cash_balance ?? null,
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
        const { user_id, date, net_equity, cash_balance, year } = body;

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
            INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, year, updated_at)
            VALUES (?, ?, ?, ?, ?, unixepoch())
            ON CONFLICT(user_id, date) DO UPDATE SET
            net_equity = excluded.net_equity,
            cash_balance = excluded.cash_balance,
            year = excluded.year,
            updated_at = unixepoch()
        `).bind(user_id, date, net_equity, cash_balance, targetYear).run();

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
        const { id, date, net_equity, cash_balance } = body;

        if (!id || !date || net_equity === undefined) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        const db = await getDb();
        const result = await db.prepare(`
            UPDATE DAILY_NET_EQUITY 
            SET date = ?, net_equity = ?, cash_balance = ?, updated_at = unixepoch()
            WHERE id = ?
        `).bind(date, net_equity, cash_balance, id).run();

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
        const { id, mode, user_id, year, delete_benchmarks } = body;

        // Mode: 'single' (default) or 'all'
        const isBulk = mode === 'all';

        const db = await getDb();

        if (isBulk) {
            if (!user_id || !year) {
                return NextResponse.json({ error: 'Missing user_id or year for bulk delete' }, { status: 400 });
            }

            // 1. Delete Net Equity Records ONLY
            // Unlike previous version, we DO NOT delete market data (QQQ/QLD) as that is global data shared across users.
            const deleteResult = await db.prepare(`DELETE FROM DAILY_NET_EQUITY WHERE user_id = ? AND year = ?`).bind(user_id, year).run();

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
            return NextResponse.json({ success: true });
        }

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
