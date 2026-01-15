import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

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
                // Admin asking for all data (likely for dashboard cards)
                targetUserId = null;
                isBulkFetch = true;
            } else {
                // Customer defaults to self
                targetUserId = user.id;
            }
        }

        const db = await getDb();

        if (isBulkFetch) {
            // Bulk fetch for Admin Dashboard Cards
            // Filter by YEAR
            const equityRecords = await db.prepare(`SELECT * FROM DAILY_NET_EQUITY WHERE year = ? ORDER BY user_id, date ASC`).bind(year).all();
            const deposits = await db.prepare(`SELECT * FROM DEPOSITS ORDER BY user_id, deposit_date ASC`).all(); // Deposits don't have year column? Checks migration 0017... No, DEPOSITS wasn't modified? Wait, let's assume global deposits history is fine, or filter if needed.
            // Actually, for performance calc of a specific year, we might need deposits from that year? 
            // Or all deposits to calculate cumulative? 
            // Usually "Year Performance" resets at Jan 1. So we only need deposits in that year?
            // "Annualized Return" for 2026 implies starting from 2026-01-01.
            // Let's filter deposits by date range of the year.

            const startOfYear = new Date(Date.UTC(year, 0, 1)).getTime() / 1000;
            const endOfYear = new Date(Date.UTC(year + 1, 0, 1)).getTime() / 1000;

            // ... (rest of logic) ...
            // Let's update the deposit query to be efficient if possible, or filter in memory.
            // Given DEPOSITS table structure from previous reads (it has deposit_date), we can filter.

            // However, for "Net Equity" calculation, if we rely on "Daily Return", we only need 
            // Equity(T), Equity(T-1), Deposit(T).
            // Equity(T-1) might be Dec 31 of previous year if T is Jan 1.
            // Ideally we fetch a bit more context or just the year.

            // Simplified: Just fetch all deposits for now to be safe, or filter in memory.

            // ... (rest of logic is map) ...

            // We need to fetch Users to return basic info too (name/email)
            // Filter users by year? USERS has year column.
            const users = await db.prepare(`SELECT id, user_id, email, initial_cost FROM USERS WHERE role = 'customer'`).all();

            // ... (rest of the map logic) ...

            // Re-implementing the bulk logic with year filtering:
            const userSummaries = (users.results as any[]).map(u => {
                const uEq = (equityRecords.results as any[]).filter(r => r.user_id === u.id);
                // ...
                // (Optimized: Filter deposits for this user efficiently)
                const uDep = (deposits.results as any[]).filter(d => d.user_id === u.id);

                if (uEq.length === 0) return {
                    ...u,
                    current_net_equity: (u as any).initial_cost || 0,
                    stats: null
                };

                // ... (Calculation Logic) ...
                // 1. Map Deposits
                const depositMap = new Map<number, number>();
                uDep.forEach(d => {
                    // Only care about deposits relevant to the equity dates? 
                    // Or all deposits? 
                    // Using all deposits for map is safe.
                    const dateObj = new Date(d.deposit_date * 1000);
                    const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
                    const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
                    depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
                });

                let prevNavRatio = 1.0;
                let prevEquity = 0;
                let peakNavRatio = 1.0;
                let minDrawdown = 0;
                let newHighCount = 0;
                let dailyReturns: number[] = [];

                uEq.forEach((row, i) => {
                    const date = row.date;
                    const equity = row.net_equity;

                    // Deposit matching
                    const dateObj = new Date(date * 1000);
                    const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
                    const dailyDeposit = depositMap.get(midnight) || 0;

                    let dailyReturn = 0;
                    // Special handling for first day of the year? 
                    // If we don't have previous year data, we start fresh.
                    // If i=0, prevEquity=0. dailyReturn=0.

                    if (i > 0 && prevEquity !== 0) {
                        dailyReturn = (equity - dailyDeposit - prevEquity) / prevEquity;
                    }

                    // Log Daily Return
                    if (i > 0) dailyReturns.push(dailyReturn);

                    const navRatio = prevNavRatio * (1 + dailyReturn);

                    if (navRatio > peakNavRatio) {
                        peakNavRatio = navRatio;
                        newHighCount++;
                    }

                    const dd = (navRatio - peakNavRatio) / peakNavRatio;
                    if (dd < minDrawdown) minDrawdown = dd;

                    prevNavRatio = navRatio;
                    prevEquity = equity;
                });

                // Calculate Monthly Stats
                const monthlyStats: any[] = [];
                for (let m = 0; m < 12; m++) {
                    const currentYear = year;
                    const monthStart = new Date(Date.UTC(currentYear, m, 1)).getTime() / 1000;
                    const nextMonthStart = new Date(Date.UTC(currentYear, m + 1, 1)).getTime() / 1000;

                    // Filter records within this month
                    const monthRecords = uEq.filter(r => r.date >= monthStart && r.date < nextMonthStart);

                    if (monthRecords.length === 0) {
                        monthlyStats.push({
                            month: m + 1,
                            net_equity: 0,
                            profit: 0,
                            return_rate: 0
                        });
                        continue;
                    }

                    // Get End Equity (Last record of the month)
                    const endRecord = monthRecords[monthRecords.length - 1];
                    const endEquity = endRecord.net_equity;

                    // Get Start Equity (End of previous month or Initial Cost)
                    // We need to find the equity closest to the start of the month (but before or on first day)
                    // Efficient way: loop through all records and track
                    // Or simpler: Use the `previous` record relative to the first record of the month

                    let startEquity = (u as any).initial_cost || 0;

                    // Find the record immediately preceding the month's first record
                    const firstRecordIndex = uEq.findIndex(r => r.date >= monthStart);
                    if (firstRecordIndex > 0) {
                        startEquity = uEq[firstRecordIndex - 1].net_equity;
                    } else if (firstRecordIndex === 0) {
                        // If it's the very first record of the year, startEquity is initial_cost
                        // (Already set default)
                    }

                    // Calculate Net Deposits in this month
                    let monthDeposits = 0;
                    uDep.forEach(d => {
                        if (d.deposit_date >= monthStart && d.deposit_date < nextMonthStart) {
                            monthDeposits += (d.transaction_type === 'withdrawal' ? -d.amount : d.amount);
                        }
                    });

                    // PnL = End - Start - NetFlow
                    const profit = endEquity - startEquity - monthDeposits;

                    // Return Rate = PnL / (Start + Weighted Flows)
                    // Simplified TWR: Product(1+r) - 1 for daily returns in this month?
                    // We already calculated daily returns in the loop above strictly? 
                    // Let's re-calculate monthly return using the daily returns we identified.
                    // We need to match dates.

                    let monthReturn = 0;
                    // Filter daily returns that belong to this month
                    // We need to store daily returns with dates in the main loop or re-calculate
                    // Let's use TWR from daily returns if possible, or Simple Return if TWR is too complex to map back
                    // Simple Return: profit / startEquity (if flows are negligible or handled)
                    // Better: PnL / (Start + Deposits/2) approximation commonly used if daily not avail
                    // BUT we have daily returns! 
                    // Let's grab daily returns for this month.

                    // Optimization: We didn't store dates with `dailyReturns` array above.
                    // Let's just calculate TWR using the same logic for the subset.

                    let mPrevEquity = startEquity;
                    let mCompounded = 1.0;

                    monthRecords.forEach(r => {
                        const rDate = new Date(r.date * 1000);
                        const rMidnight = new Date(Date.UTC(rDate.getFullYear(), rDate.getMonth(), rDate.getDate())).getTime() / 1000;
                        const rDeposit = depositMap.get(rMidnight) || 0;

                        // If this is the very first record ever for user, return is 0 for that day usually?
                        // Or (Equity - Deposit - Initial) / Initial

                        let dRet = 0;
                        if (mPrevEquity !== 0) {
                            dRet = (r.net_equity - rDeposit - mPrevEquity) / mPrevEquity;
                        }

                        mCompounded *= (1 + dRet);
                        mPrevEquity = r.net_equity;
                    });

                    monthReturn = mCompounded - 1;

                    monthlyStats.push({
                        month: m + 1,
                        net_equity: endEquity,
                        profit: profit,
                        return_rate: monthReturn
                    });
                }

                const startTime = uEq[0].date;
                const endTime = uEq[uEq.length - 1].date;
                const daySpan = Math.max(1, (endTime - startTime) / 86400);

                const annualizedReturn = daySpan > 0 ? (Math.pow(prevNavRatio, 365 / daySpan) - 1) : 0;

                // Std Dev
                let stdDev = 0;
                let annualizedStdDev = 0;
                if (dailyReturns.length > 0) {
                    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
                    const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / dailyReturns.length;
                    stdDev = Math.sqrt(variance);
                    annualizedStdDev = stdDev * Math.sqrt(252);
                }

                const totalReturn = prevNavRatio - 1;

                const sharpe = annualizedStdDev !== 0 ? (annualizedReturn - 0.02) / annualizedStdDev : 0;

                const currentNetEquity = uEq.length > 0 ? uEq[uEq.length - 1].net_equity : ((u as any).initial_cost || 0);

                return {
                    ...u,
                    initial_cost: (u as any).initial_cost || 0,
                    current_net_equity: currentNetEquity,
                    stats: {
                        startDate: uEq[0].date,
                        returnPercentage: totalReturn,
                        maxDrawdown: minDrawdown,
                        annualizedReturn,
                        annualizedStdDev,
                        sharpeRatio: sharpe,
                        newHighCount,
                        newHighFreq: daySpan > 0 ? newHighCount / daySpan : 0
                    },
                    monthly_stats: monthlyStats
                };
            });

            return NextResponse.json({ success: true, data: userSummaries });
        }

        // 1. Fetch Net Equity records (Single User)
        const equityRecords = await db.prepare(`
            SELECT * FROM DAILY_NET_EQUITY 
            WHERE user_id = ? AND year = ?
            ORDER BY date ASC
        `).bind(targetUserId, year).all();

        // 2. Fetch Deposits for the same user (All time? Or Year?)
        // Fetching all for simplicity in matching
        const deposits = await db.prepare(`
            SELECT * FROM DEPOSITS 
            WHERE user_id = ? 
            ORDER BY deposit_date ASC
        `).bind(targetUserId).all();

        // ... (rest of single user logic same as before) ...
        const depositMap = new Map<number, number>();
        (deposits.results as any[]).forEach(d => {
            const dateObj = new Date(d.deposit_date * 1000);
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
            const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
            depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
        });

        const rows = equityRecords.results as any[];
        const resultData = [];

        let prevNavRatio = 1.0;
        let prevEquity = 0;
        let peakNavRatio = 1.0;

        if (rows.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // Fetch user's initial cost
        const userRecord = await db.prepare('SELECT initial_cost FROM USERS WHERE id = ?').bind(targetUserId).first();
        const initialCost = (userRecord?.initial_cost as number) || 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const date = row.date;
            const equity = row.net_equity;

            const dateObj = new Date(date * 1000);
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
            const dailyDeposit = depositMap.get(midnight) || 0;

            let dailyReturn = 0;

            if (i === 0) {
                // For the first record, compare with Initial Cost if available
                if (initialCost !== 0) {
                    dailyReturn = (equity - dailyDeposit - initialCost) / initialCost;
                } else {
                    dailyReturn = 0;
                }
            } else {
                if (prevEquity !== 0) {
                    dailyReturn = (equity - dailyDeposit - prevEquity) / prevEquity;
                }
            }

            const navRatio = prevNavRatio * (1 + dailyReturn);

            let isNewHigh = false;
            if (navRatio > peakNavRatio) {
                peakNavRatio = navRatio;
                isNewHigh = true;
            }

            const drawdown = (navRatio - peakNavRatio) / peakNavRatio;

            resultData.push({
                id: row.id,
                date: row.date,
                net_equity: equity,
                daily_deposit: dailyDeposit,
                daily_return: dailyReturn,
                nav_ratio: navRatio,
                running_peak: peakNavRatio,
                drawdown: drawdown,
                is_new_high: isNewHigh
            });

            prevEquity = equity;
            prevNavRatio = navRatio;
        }

        // Reverse to show newest first (User Request: "From near to far" - confirmed standard)
        return NextResponse.json({
            success: true,
            data: resultData.reverse()
        });

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

        // Determine year if not provided
        let targetYear = year;
        if (!targetYear) {
            const dateObj = new Date(date * 1000);
            targetYear = dateObj.getFullYear();
        }

        const db = await getDb();

        // Upsert
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

        // Update existing record
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

        const result = await db.prepare(`
            DELETE FROM DAILY_NET_EQUITY WHERE id = ?
        `).bind(id).run();

        if (result.meta.changes === 0) {
            return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
