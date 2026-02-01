import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { clearMarketDataCache } from '@/lib/market-data';
import { clearCache, clearCacheByPattern } from '@/lib/response-cache';

// Use environment variable in staging/production, fallback to localhost key
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || 'BJ9X47DS0OLOPYM0';

interface AlphaVantageResponse {
    'Meta Data': any;
    'Time Series (Daily)': {
        [date: string]: {
            '1. open': string;
            '2. high': string;
            '3. low': string;
            '4. close': string;
            '5. volume': string;
        };
    };
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { userId, symbol } = body;

        if (!userId) {
            return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
        }

        const DB = await getDb();

        // Fetch admin user's API key from database (admin user has id = 1 or user_id = 'admin')
        const adminResult = await DB.prepare(
            'SELECT api_key FROM USERS WHERE user_id = ? OR id = ?'
        ).bind('admin', 1).first();

        // Use admin's API key if available, otherwise fall back to environment variable
        const apiKey = (adminResult as any)?.api_key || process.env.ALPHA_VANTAGE_API_KEY || 'BJ9X47DS0OLOPYM0';
        console.log(`Using admin's API key for market data backfill`);

        // Symbols to process - use symbol from request if provided, otherwise update all symbols
        const symbols = symbol ? [symbol] : ['QQQ', 'QLD'];
        let totalInserted = 0;
        const errors: string[] = [];

        // Helper function to check if a date is a trading day
        const isTradingDay = (date: Date): boolean => {
            const day = date.getDay();
            return day !== 0 && day !== 6; // Skip weekends
        };

        // Helper function to get trading days between two dates
        const getTradingDaysBetween = (startDate: Date, endDate: Date): Date[] => {
            const days: Date[] = [];
            const current = new Date(startDate);
            while (current <= endDate) {
                if (isTradingDay(current)) {
                    days.push(new Date(current));
                }
                current.setDate(current.getDate() + 1);
            }
            return days;
        };





        for (const sym of symbols) {
            try {
                // Check for existing data
                const { results: latestResults } = await DB.prepare(
                    `SELECT MAX(date) as latest_date, COUNT(*) as record_count FROM market_prices WHERE symbol = ?`
                ).bind(sym).all();

                const hasData = latestResults && latestResults.length > 0 && (latestResults[0] as any).record_count > 0;
                const latestTimestamp = hasData ? (latestResults[0] as any).latest_date : null;

                let datesToFill: Date[] = [];
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                if (hasData && latestTimestamp) {
                    // We have existing data - only fill gaps from latest date to today
                    const latestDate = new Date(latestTimestamp * 1000);
                    latestDate.setDate(latestDate.getDate() + 1); // Start from next day
                    datesToFill = getTradingDaysBetween(latestDate, today);
                    console.log(`${sym}: Found existing data up to ${new Date(latestTimestamp * 1000).toISOString().split('T')[0]}, filling ${datesToFill.length} missing days`);
                } else {
                    // No existing data - we'll fetch all available data from API (compact = 100 days)
                    console.log(`${sym}: No existing data, will fetch all available data`);
                }

                // Fetch from Alpha Vantage (using free tier endpoint with compact output)
                // Note: Free tier only supports outputsize=compact (last 100 days)
                const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${sym}&outputsize=compact&apikey=${apiKey}`;

                console.log(`Fetching Alpha Vantage data for ${sym}...`);
                const response = await fetch(url);

                if (!response.ok) {
                    errors.push(`Failed to fetch ${sym}: HTTP ${response.status}`);
                    continue;
                }

                const data: AlphaVantageResponse = await response.json();

                console.log(`Alpha Vantage API response for ${sym}:`, JSON.stringify(data).substring(0, 300));

                // Check for API errors
                if (data['Meta Data'] === undefined) {
                    const errorMsg = `Invalid response for ${sym}: ${JSON.stringify(data)}`;
                    console.error(errorMsg);
                    errors.push(errorMsg);
                    continue;
                }

                const timeSeries = data['Time Series (Daily)'];
                if (!timeSeries) {
                    errors.push(`No time series data for ${sym}`);
                    continue;
                }

                // Prepare batch insert
                const insertStmt = DB.prepare(
                    `INSERT INTO market_prices (symbol, date, close_price) 
                     VALUES (?, ?, ?) 
                     ON CONFLICT(symbol, date) DO UPDATE SET close_price=excluded.close_price`
                );

                const batch: any[] = [];

                if (hasData && datesToFill.length > 0) {
                    // Only insert prices for the missing dates
                    for (const missingDate of datesToFill) {
                        const dateStr = `${missingDate.getFullYear()}-${String(missingDate.getMonth() + 1).padStart(2, '0')}-${String(missingDate.getDate()).padStart(2, '0')}`;

                        if (timeSeries[dateStr]) {
                            const closePrice = parseFloat(timeSeries[dateStr]['4. close']);
                            const timestamp = Date.UTC(missingDate.getFullYear(), missingDate.getMonth(), missingDate.getDate()) / 1000;
                            batch.push(insertStmt.bind(sym, timestamp, closePrice));
                        }
                    }
                } else {
                    // No existing data - insert all available prices from API
                    for (const [dateStr, values] of Object.entries(timeSeries)) {
                        const closePrice = parseFloat(values['4. close']); // Free tier uses '4. close'

                        // Convert date string to UTC midnight timestamp
                        const [year, month, day] = dateStr.split('-').map(Number);
                        const timestamp = Date.UTC(year, month - 1, day) / 1000;

                        batch.push(insertStmt.bind(sym, timestamp, closePrice));
                    }
                }

                console.log(`Prepared ${batch.length} records for ${sym}`);

                // Execute batch
                if (batch.length > 0) {
                    await DB.batch(batch);
                    totalInserted += batch.length;
                    console.log(`Inserted ${batch.length} records for ${sym}`);

                    // Clear caches for this symbol to ensure fresh data is fetched
                    clearMarketDataCache(sym);
                    // Clear ALL benchmark caches that involve this symbol (for all users)
                    // Pattern: benchmark-{userId}-{symbol}-{year}
                    clearCacheByPattern(`benchmark-.*-${sym}-.*`);
                }

                // Add delay between API calls to respect rate limits (5 calls/minute = 12 seconds between calls)
                if (symbols.indexOf(sym) < symbols.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 13000));
                }

            } catch (error: any) {
                console.error(`Error processing ${sym}:`, error);
                errors.push(`Error processing ${sym}: ${error.message}`);
            }
        }

        return NextResponse.json({
            success: true,
            totalInserted,
            symbols,
            errors: errors.length > 0 ? errors : undefined,
            message: `成功回填/更新 ${totalInserted} 筆市場資料`
        });

    } catch (error: any) {
        console.error('Backfill API Error:', error);
        return NextResponse.json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
