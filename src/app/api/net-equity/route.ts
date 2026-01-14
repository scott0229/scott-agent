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
            // Bulk fetch approach: Fetch ALL equity records and DEPOSITS, then group by user
            // This is heavy but necessary for the cards if we don't have pre-calc stats.

            const equityRecords = await db.prepare(`SELECT * FROM DAILY_NET_EQUITY ORDER BY user_id, date ASC`).all();
            const deposits = await db.prepare(`SELECT * FROM DEPOSITS ORDER BY user_id, deposit_date ASC`).all();

            // We need to fetch Users to return basic info too (name/email)
            const users = await db.prepare(`SELECT id, user_id, email FROM USERS WHERE role = 'customer'`).all();

            // Logic to aggregate per user
            // We will reuse the calculation logic by refactoring it into a helper or loop.
            // For now, let's just return the raw data grouped by user? 
            // Better: Calculate the summary stats here to keep frontend light?
            // "Annualized Return", "Sharpe", "Max Drawdown"

            // Let's perform a standardized calculation for each user.
            const userSummaries = (users.results as any[]).map(u => {
                const uEq = (equityRecords.results as any[]).filter(r => r.user_id === u.id);
                const uDep = (deposits.results as any[]).filter(d => d.user_id === u.id);

                if (uEq.length === 0) return { ...u, stats: null };

                // --- CALCULATION LOGIC REUSE (Simplified Version for Card) ---
                // We need Date, Daily Return, etc. to compute Sharpe.

                // 1. Map Deposits
                const depositMap = new Map<number, number>();
                uDep.forEach(d => {
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
                    if (i > 0 && prevEquity !== 0) {
                        dailyReturn = (equity - dailyDeposit - prevEquity) / prevEquity;
                    }

                    // Log Daily Return for StdDev
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

                // Final Stats
                const totalReturn = prevNavRatio - 1;
                const days = uEq.length; // Approximate trading days?
                // Annualized Return: ((1+R)^(365/Days)) - 1 ? Or 252?
                // User screenshot says "Start Date" -> "25-12-31".
                // If days < 1 year, scaling up might look huge.
                const years = days / 252; // Market days approx? Or calendar? 
                // Let's use simple calendar days difference from start to end?
                const startTime = uEq[0].date;
                const endTime = uEq[uEq.length - 1].date;
                const daySpan = Math.max(1, (endTime - startTime) / 86400);

                const annualizedReturn = daySpan > 0 ? (Math.pow(prevNavRatio, 365 / daySpan) - 1) : 0;

                // Std Dev
                // Calculate variance of dailyReturns
                let stdDev = 0;
                let annualizedStdDev = 0;
                if (dailyReturns.length > 0) {
                    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
                    const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / dailyReturns.length;
                    stdDev = Math.sqrt(variance);
                    annualizedStdDev = stdDev * Math.sqrt(252);
                }

                const sharpe = annualizedStdDev !== 0 ? (annualizedReturn - 0.02) / annualizedStdDev : 0; // Assume 2% Rf

                return {
                    ...u,
                    stats: {
                        startDate: uEq[0].date,
                        returnPercentage: totalReturn,
                        maxDrawdown: minDrawdown,
                        annualizedReturn,
                        annualizedStdDev,
                        sharpeRatio: sharpe,
                        newHighCount,
                        newHighFreq: days > 0 ? newHighCount / days : 0
                    }
                };
            });

            return NextResponse.json({ success: true, data: userSummaries });
        }

        // 1. Fetch Net Equity records (Single User)
        const equityRecords = await db.prepare(`
            SELECT * FROM DAILY_NET_EQUITY 
            WHERE user_id = ? 
            ORDER BY date ASC
        `).bind(targetUserId).all();

        // 2. Fetch Deposits for the same user
        const deposits = await db.prepare(`
            SELECT * FROM DEPOSITS 
            WHERE user_id = ? 
            ORDER BY deposit_date ASC
        `).bind(targetUserId).all();

        // Map deposits by date (YYYY-MM-DD unix timestamp at 00:00:00)
        // Note: Deposits might have specific times. We need to aggregate by day.
        // Assuming DAILY_NET_EQUITY.date is aligned to 00:00:00 UTC or local.
        // We'll normalize deposit dates to the same midnight timestamp for matching.

        const depositMap = new Map<number, number>();
        (deposits.results as any[]).forEach(d => {
            // Normalize deposit timestamp to midnight (or assume input is compatible)
            // Existing deposits use unix timestamp (seconds).
            // Let's rely on frontend or import to align `DAILY_NET_EQUITY.date` correctly.
            // For matching, we treat the deposit as belonging to the day it occurred.
            // We should align to the nearest previous midnight? Or just strict date matching?
            // "Daily Deposit" usually corresponds to the specific date of the Net Equity entry.
            // Let's assume strict date matching for now (both are timestamps). 
            // If they differ, we might need a daily bucket approach. 
            // Implementation: Simple bucket by day string YYYY-MM-DD

            const dateObj = new Date(d.deposit_date * 1000);
            // Reset to 00:00:00 for bucketing, using local time as implicit standard or UTC?
            // Ideally use UTC to avoid timezone mess.
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;

            // However, DAILY_NET_EQUITY date is also an integer.
            // Let's bucket deposits by the same logic used for equity dates.
            // Assuming equity dates are stored as UTC midnights.

            const dailySum = depositMap.get(midnight) || 0;
            // transaction_type: 'deposit' (+), 'withdrawal' (-)
            const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
            depositMap.set(midnight, dailySum + amount);
        });

        const rows = equityRecords.results as any[];
        const resultData = [];

        let prevNavRatio = 1.0;
        let prevEquity = 0;
        let runningPeak = 0; // Peak NAV Ratio or Peak Equity? 
        // "Running Peak" usually refers to Net Equity High Water Mark for performance fees, 
        // OR Peak NAV Ratio for drawdown calculations.
        // Given "Drawdown" column, it usually implies drawdown from Peak NAV (return based) or Peak Equity (value based)?
        // If user deposits $1M, Equity hits peak. That's not performance. 
        // Drawdown should be based on NAV Ratio (Pure Performance) OR if it's "Account Drawdown" (Value).
        // User screenshot: "New High" stars aligned with NAV ~101/102%. 
        // Let's track Peak NAV Ratio.

        let peakNavRatio = 1.0; // Starts at 100%

        // Optimization: If no records, return empty
        if (rows.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // We need to iterate chronologically
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const date = row.date; // Seconds
            const equity = row.net_equity;

            // Normalize row date to buckets to find deposits
            const dateObj = new Date(date * 1000);
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
            const dailyDeposit = depositMap.get(midnight) || 0;

            let dailyReturn = 0;

            if (i === 0) {
                // First day. 
                // Return is 0 unless we have a "yesterday" reference. 
                // We'll calculate "Return since inception" effectively 0 for the first snapshot relative to principal?
                // Or simplified: Day 1 Return = 0.
                dailyReturn = 0;

                // If it's the very first record, NAV is 1.0
                // UNLESS we want to capture the first day's MOVEMENT if we knew the start capital.
                // Assuming start capital = Equity - Profit? Unknown.
                // We'll start flat.
            } else {
                // Formula: (TodayNE - TodayDeposit - PrevNE) / PrevNE
                // Denominator: Previous Net Equity.
                // If PrevNE is 0 (bankruptcy?), handle div by zero.
                if (prevEquity !== 0) {
                    dailyReturn = (equity - dailyDeposit - prevEquity) / prevEquity;
                }
            }

            // NAV Ratio (TWR)
            // CurrentNAV = PrevNAV * (1 + DailyReturn)
            const navRatio = prevNavRatio * (1 + dailyReturn);

            // Update Running Peak (NAV based)
            let isNewHigh = false;
            // Check if current NAV is > Peak
            // Float comparison tolerance?
            if (navRatio > peakNavRatio) {
                peakNavRatio = navRatio;
                isNewHigh = true; // Use simple logic: if it exceeds previous peak
            }

            // Also track Equity Peak?
            // "Running Peak" in table: value seems to be percentage in screenshot (100.00%, 101.60%). 
            // So it tracks the Peak NAV Ratio.

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

        return NextResponse.json({
            success: true,
            data: resultData
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
        const { user_id, date, net_equity } = body;

        if (!user_id || !date || net_equity === undefined) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        const db = await getDb();

        // Upsert
        const result = await db.prepare(`
            INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, updated_at)
            VALUES (?, ?, ?, unixepoch())
            ON CONFLICT(user_id, date) DO UPDATE SET
            net_equity = excluded.net_equity,
            updated_at = unixepoch()
        `).bind(user_id, date, net_equity).run();

        return NextResponse.json({ success: true, id: result.meta.last_row_id });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
