import { getDb } from '@/lib/db';

interface MarketPrice {
    date: number;
    close: number;
}

// In-memory cache for market data
// Key: `${symbol}-${startDate}-${endDate}`
const marketDataCache = new Map<string, { data: MarketPrice[], timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getMarketData(symbol: string, startDate: number, endDate: number): Promise<MarketPrice[]> {
    // Generate cache key
    const cacheKey = `${symbol}-${startDate}-${endDate}`;

    // Check cache
    const cached = marketDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log(`Market data cache HIT for ${symbol}`);
        return cached.data;
    }

    console.log(`Market data cache MISS for ${symbol}, fetching from DB...`);

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

        const data = (results as any[]) || [];

        // Store in cache
        marketDataCache.set(cacheKey, {
            data,
            timestamp: Date.now()
        });

        return data;

    } catch (e) {
        console.error("Error fetching market data:", e);
        return [];
    }
}
