import { getDb } from '@/lib/db';

interface MarketPrice {
    date: number;
    close: number;
}

export async function getMarketData(symbol: string, startDate: number, endDate: number): Promise<MarketPrice[]> {
    const DB = await getDb();

    // 1. Check DB cache
    try {
        const { results } = await DB.prepare(
            `SELECT date, close_price as close FROM market_prices 
             WHERE symbol = ? AND date >= ? AND date <= ? 
             ORDER BY date ASC`
        )
            .bind(symbol, startDate, endDate)
            .all();

        // If we have data covering the range (simplified check: just checking if we have *some* data is risky, 
        // ideally we check for gaps. For now, let's assume if we have data for the end date, we are good? 
        // Or better: fetch missing days. 
        // Simple approach: Always fetch latest from API if 'endDate' is recent (today/yesterday).
        // But to be robust: Fetch everything from API if DB is empty or missing range.

        // Let's implement a policy: 
        // If results are found, return them. 
        // If not, fetch from API for the entire requested range and cache.
        // NOTE: This simple policy doesn't handle partial updates well (e.g. yesterday was missing).
        // Improved policy: Find the latest date in DB. If < endDate, fetch from latest+1 to endDate.

        // Use a simpler approach for MVP:
        // Always try to fetch new data if the request involves "today" or "yesterday".
        // Or just let the UI trigger a "refresh" if needed.

        // Let's stick to: Fetch from Yahoo if DB result count is too low compared to expected days?

        // BETTER: Just fetch from Yahoo for the requested range, and INSERT OR IGNORE into DB.
        // Then read from DB. This acts as a "fetch and cache" logic every time.
        // Yahoo API is fast enough for low traffic.

        // HOWEVER, we want to minimize external calls.
        // Let's use the Yahoo fetch result to UPSERT into DB.

        const yahooData = await fetchYahooFinance(symbol, startDate, endDate);
        if (yahooData.length > 0) {
            const stmt = DB.prepare(`
                INSERT INTO market_prices (symbol, date, close_price) 
                VALUES (?, ?, ?) 
                ON CONFLICT(symbol, date) DO UPDATE SET close_price=excluded.close_price
            `);

            const batch = yahooData.map(d => stmt.bind(symbol, d.date, d.close));
            await DB.batch(batch);
        }

        // Read back from DB to ensure consistency
        const { results: finalResults } = await DB.prepare(
            `SELECT date, close_price as close FROM market_prices 
             WHERE symbol = ? AND date >= ? AND date <= ? 
             ORDER BY date ASC`
        )
            .bind(symbol, startDate, endDate)
            .all();

        return (finalResults as any[]) || [];

    } catch (e) {
        console.error("Error fetching market data:", e);
        return [];
    }
}

async function fetchYahooFinance(symbol: string, startDate: number, endDate: number): Promise<MarketPrice[]> {
    try {
        // Yahoo Chart API v8
        // https://query1.finance.yahoo.com/v8/finance/chart/QQQ?period1=1704067200&period2=1735689600&interval=1d
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate + 86400}&interval=1d`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Yahoo API status: ${res.status}`);

        const data = await res.json();
        const result = data.chart.result[0];

        if (!result || !result.timestamp || !result.indicators.quote[0]) return [];

        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];

        const prices: MarketPrice[] = [];

        for (let i = 0; i < timestamps.length; i++) {
            const date = timestamps[i];
            const close = quotes.close[i];

            // Adjust to midnight UTC to match our system's "Daily" record alignment if needed.
            // But Yahoo timestamps are usually market open/close times (e.g. 9:30 or 16:00 ET).
            // Our system uses UTC timestamps for dates (usually midnight).
            // We should normalize the date to avoid mismatches.

            // Normalize to YYYY-MM-DD UTC midnight
            // Create date from timestamp (seconds * 1000)
            const d = new Date(date * 1000);

            // Create midnight UTC timestamp for that day
            const midnight = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 1000;

            if (close !== null && close !== undefined) {
                prices.push({
                    date: midnight,
                    close: close
                });
            }
        }

        return prices;
    } catch (e) {
        console.error(`Failed to load from Yahoo for ${symbol}:`, e);
        return [];
    }
}
