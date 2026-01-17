import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getMarketData } from '@/lib/market-data';

export const runtime = 'edge';

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

        const basePrice = findPrice(baseTargetDate);

        if (!basePrice) {
            return NextResponse.json({ success: true, data: [] });
        }

        let prevNavRatio = 1.0;
        let prevEquity = initialCost;
        let peakNavRatio = 1.0;
        let prevPrice = basePrice;
        let shares = initialCost / basePrice;

        const benchmarkData = userRecords.map((record: any, index: number) => {
            const date = record.date;
            const currentPrice = findPrice(date) || prevPrice;

            // Match deposit
            const dateObj = new Date(date * 1000);
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
            const dailyDeposit = depositMap.get(midnight) || 0;

            // Strategy: Buy/Sell shares with Deposit
            // User requested "Buy at Closing Price" (market close).
            // This means the deposit does NOT participate in today's price movement.
            if (dailyDeposit !== 0 && currentPrice > 0) {
                const sharesChange = dailyDeposit / currentPrice;
                shares += sharesChange;
            }

            // Hypothetical Equity
            const hypotheticalEquity = shares * currentPrice;

            let dailyReturn = 0;
            const startVal = (index === 0 ? initialCost : prevEquity);

            if (startVal + dailyDeposit !== 0) {
                dailyReturn = (hypotheticalEquity - dailyDeposit - startVal) / (startVal + dailyDeposit);
            }

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
