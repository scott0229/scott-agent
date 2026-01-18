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

        // Manual Mode: Only return what is in the DB.
        // We no longer fetch from Yahoo Finance to avoid Cloudflare timeouts.
        return (results as any[]) || [];

    } catch (e) {
        console.error("Error fetching market data:", e);
        return [];
    }
}
