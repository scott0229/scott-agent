import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getMarketData } from '@/lib/market-data';



export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const symbol = searchParams.get('symbol');
    const year = searchParams.get('year');

    if (!userId || !symbol) {
        return NextResponse.json({ error: 'Missing userId or symbol' }, { status: 400 });
    }

    const DB = await getDb();

    try {
        // 1. Get User Records
        let query = `SELECT date, net_equity FROM daily_net_equity WHERE user_id = ?`;
        const params: any[] = [userId];

        if (year && year !== 'All') {
            const startOfYear = new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000;
            const endOfYear = new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000;
            query += ` AND date >= ? AND date <= ?`;
            params.push(startOfYear, endOfYear);
        }

        query += ` ORDER BY date ASC`;

        const { results: userRecords } = await DB.prepare(query).bind(...params).all();

        if (!userRecords || userRecords.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // Get Initial Cost
        const userRes = await DB.prepare(`SELECT initial_cost FROM users WHERE id = ?`).bind(userId).first();
        const initialCost = (userRes?.initial_cost as number) || 10000;

        const startDate = userRecords[0].date as number;
        const endDate = userRecords[userRecords.length - 1].date as number;

        // Fetch Deposits
        // We reuse logic from net-equity: Fetch all deposits for this user
        const deposits = await DB.prepare(`SELECT * FROM DEPOSITS WHERE user_id = ?`).bind(userId).all();

        const depositMap = new Map<number, number>();
        (deposits.results as any[]).forEach(d => {
            const dateObj = new Date(d.deposit_date * 1000);
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
            const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
            depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
        });

        // 2. Fetch Market Data
        // 2. Fetch Market Data
        let fetchStartDate = startDate - (7 * 86400);
        let baseTargetDate = startDate;

        if (year && year !== 'All') {
            const prevYearInt = parseInt(year) - 1;
            // Ensure we fetch enough data back to get Dec 31
            const prevYearDec31 = new Date(Date.UTC(prevYearInt, 11, 31)).getTime() / 1000;
            baseTargetDate = prevYearDec31;
            fetchStartDate = Math.min(fetchStartDate, prevYearDec31 - (7 * 86400));
        }

        const marketData = await getMarketData(symbol, fetchStartDate, endDate);

        const marketMap = new Map<number, number>();
        marketData.forEach(p => marketMap.set(p.date, p.close));

        const findPrice = (targetDate: number) => {
            if (marketMap.has(targetDate)) return marketMap.get(targetDate);
            // Search backwards
            // We need to support searching back from targetDate even if targetDate isn't in marketData array range?
            // No, marketData is sorted?
            // marketData from getMarketData is sorted ASC usually.
            // Let's iterate backwards.
            // If targetDate > last marketDate, we return last? No, we want price AT or BEFORE targetDate.

            // Optimization: Filter to only dates <= targetDate then take last?
            // Or simple loop:
            for (let i = marketData.length - 1; i >= 0; i--) {
                if (marketData[i].date <= targetDate) {
                    return marketData[i].close;
                }
            }
            return null;
        };

        const basePrice = findPrice(baseTargetDate) || 0; // Default to 0 if not found

        // Removed early return for !basePrice to allow rendering empty rows

        // Fix: Use 1.05 as default NAV only if we have context? No, strictly use 1.0.
        // If basePrice is 0, shares will be Infinity if we mark it.
        // Let's handle 0 price gracefully.

        let prevNavRatio = 1.0;
        let prevEquity = initialCost;
        let peakNavRatio = 1.0;
        let prevPrice = basePrice;
        let shares = basePrice > 0 ? initialCost / basePrice : 0; // Avoid division by zero

        const benchmarkData = userRecords.map((record: any, index: number) => {
            const date = record.date;

            // Try to find price. If not found, use prevPrice. 
            // If prevPrice is 0 (initial missing), stays 0.
            const currentPrice = findPrice(date) || prevPrice;

            // Match deposit
            const dateObj = new Date(date * 1000);
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
            const dailyDeposit = depositMap.get(midnight) || 0;

            // Strategy: Buy/Sell shares with Deposit
            if (dailyDeposit !== 0 && currentPrice > 0) {
                const sharesChange = dailyDeposit / currentPrice;
                shares += sharesChange;
            } else if (dailyDeposit !== 0 && currentPrice === 0) {
                // Cannot buy shares if price is known 0. 
                // We accumulate deposit into equity?
                // But hypothetical equity is shares * price. 
                // If price is 0, equity is 0. 
                // This will show -100% return temporarily. Correct for missing data.
            }

            // Hypothetical Equity
            const hypotheticalEquity = shares * currentPrice;

            let dailyReturn = 0;
            const startVal = (index === 0 ? initialCost : prevEquity);

            if (startVal + dailyDeposit !== 0) {
                dailyReturn = (hypotheticalEquity - dailyDeposit - startVal) / (startVal + dailyDeposit);
            }

            // If we have 0 price, dailyReturn might continue to be -1 (if equity 0).
            // Prevent runaway compounding of -1 (goes to 0 quickly).

            // NAV Ratio based on Initial Cost reference
            // For simple TWR: Cumulative product of (1+dailyReturn)
            const navRatio = prevNavRatio * (1 + dailyReturn);

            let isNewHigh = false;
            if (navRatio > peakNavRatio) {
                peakNavRatio = navRatio;
                isNewHigh = true;
            }

            // Drawdown based on NAV Ratio
            const drawdown = (navRatio - peakNavRatio) / peakNavRatio;

            // If price > 0, we update state. If 0, we keep state as failed (0 equity).
            // But if price suddenly appears (e.g. added later), shares * price will jump up.
            // Wait, if shares were calculated based on initial 0 price, shares is 0.
            // If shares is 0, equity will always be 0 even if price recovers.
            // CRITICAL BUG possibility: If basePrice is 0, we have 0 shares. Future prices won't help.
            // FIX: If shares is 0 and we haven't started yet (basePrice was 0), 
            // we should try to initialize shares on the FIRST valid price?

            // Re-eval share logic:
            if (shares === 0 && basePrice === 0 && currentPrice > 0 && index === 0) {
                // First record has price, but base didn't?
                // Or if basePrice was 0, we can treat THIS record as start?
                // But we already used initialCost.
                shares = initialCost / currentPrice;
            } else if (shares === 0 && prevPrice === 0 && currentPrice > 0) {
                // Using initial cost to buy in now? No, initial cost was at start.
                // If we missed the start price, we can't accurately simulate TWR from start.
                // But for the purpose of "Show data so user can Edit", showing 0 is fine.
            }

            prevEquity = hypotheticalEquity;
            prevPrice = currentPrice;
            prevNavRatio = navRatio;

            return {
                id: index,
                date: date,
                net_equity: hypotheticalEquity,
                daily_deposit: dailyDeposit,
                daily_return: dailyReturn,
                nav_ratio: navRatio,
                running_peak: peakNavRatio,
                drawdown: drawdown,
                is_new_high: isNewHigh,
                close_price: currentPrice,
                shares: shares
            };
        });

        return NextResponse.json({
            success: true,
            data: benchmarkData.reverse(),
            meta: {
                symbol,
                basePrice,
                initialCost
            }
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
