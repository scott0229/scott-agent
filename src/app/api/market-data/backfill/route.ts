import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { clearMarketDataCache } from '@/lib/market-data';
import { clearCache, clearCacheByPattern } from '@/lib/response-cache';

// API Key is now read ONLY from database (admin user's api_key field)
// No environment variable fallback - admin must configure via settings page

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

        // ONLY use database value - no fallback to environment variables
        const apiKey = (adminResult as any)?.api_key;

        if (!apiKey) {
            return NextResponse.json({
                success: false,
                error: 'API Key not configured. Please set Alpha Vantage API Key in admin settings.',
                message: 'Alpha Vantage API Key 未設定，請在管理員設定頁面中設定 API Key。'
            }, { status: 500 });
        }

        console.log(`Using admin's API key from database for market data backfill`);

        // Symbols to process
        let symbols: string[];

        if (symbol) {
            // If specific symbol provided, use it
            symbols = [symbol];
        } else {
            // Otherwise, dynamically fetch all unique symbols from all stock trades
            const { results: holdingSymbols } = await DB.prepare(
                `SELECT DISTINCT symbol FROM STOCK_TRADES ORDER BY symbol`
            ).all();

            symbols = (holdingSymbols as any[]).map((row: any) => row.symbol);

            // If no holdings found, fall back to default symbols
            if (symbols.length === 0) {
                symbols = ['QQQ', 'QLD'];
                console.log('No stock trades found, using default symbols:', symbols);
            } else {
                console.log('Fetched all stock symbols from database:', symbols);
            }
        }

        let totalInserted = 0;
        const errors: string[] = [];
        const symbolResults: { symbol: string; status: 'success' | 'failed' | 'skipped'; recordsInserted: number; error?: string }[] = [];

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
                console.log(`\n=== Processing ${sym} ===`);

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

                    // If no missing days, skip this symbol
                    if (datesToFill.length === 0) {
                        console.log(`${sym}: Already up to date, skipping API call`);
                        symbolResults.push({ symbol: sym, status: 'skipped', recordsInserted: 0 });
                        continue;
                    }
                } else {
                    // No existing data - we'll fetch all available data from API (compact = 100 days)
                    console.log(`${sym}: No existing data, will fetch all available data`);
                }

                // Fetch from Alpha Vantage (using free tier endpoint with compact output)
                // Note: Free tier only supports outputsize=compact (last 100 days)
                const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${sym}&outputsize=compact&apikey=${apiKey}`;

                console.log(`${sym}: Fetching from Alpha Vantage...`);
                const response = await fetch(url);

                if (!response.ok) {
                    const errorMsg = `HTTP ${response.status}`;
                    console.error(`${sym}: Failed to fetch - ${errorMsg}`);
                    errors.push(`${sym}: ${errorMsg}`);
                    symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });
                    continue;
                }

                const data: AlphaVantageResponse = await response.json();

                console.log(`${sym}: API response received`, JSON.stringify(data).substring(0, 200));

                // Check for API errors (rate limiting, invalid symbol, etc.)
                if (data['Meta Data'] === undefined) {
                    const errorMsg = `Invalid API response: ${JSON.stringify(data).substring(0, 200)}`;
                    console.error(`${sym}: ${errorMsg}`);
                    errors.push(`${sym}: ${errorMsg}`);
                    symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });
                    continue;
                }

                const timeSeries = data['Time Series (Daily)'];
                if (!timeSeries) {
                    const errorMsg = 'No time series data in response';
                    console.error(`${sym}: ${errorMsg}`);
                    errors.push(`${sym}: ${errorMsg}`);
                    symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });
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

                console.log(`${sym}: Prepared ${batch.length} records for insertion`);

                // Execute batch
                if (batch.length > 0) {
                    await DB.batch(batch);
                    totalInserted += batch.length;
                    console.log(`${sym}: ✅ Successfully inserted ${batch.length} records`);
                    symbolResults.push({ symbol: sym, status: 'success', recordsInserted: batch.length });

                    // Clear caches for this symbol to ensure fresh data is fetched
                    clearMarketDataCache(sym);
                    // Clear ALL benchmark caches that involve this symbol (for all users)
                    // Pattern: benchmark-{userId}-{symbol}-{year}
                    clearCacheByPattern(`benchmark-.*-${sym}-.*`);
                } else {
                    console.log(`${sym}: No new records to insert`);
                    symbolResults.push({ symbol: sym, status: 'skipped', recordsInserted: 0 });
                }

                // Add delay between API calls to respect rate limits (5 calls/minute = 12 seconds between calls)
                if (symbols.indexOf(sym) < symbols.length - 1) {
                    console.log(`Waiting 13 seconds before next API call to respect rate limits...`);
                    await new Promise(resolve => setTimeout(resolve, 13000));
                }

            } catch (error: any) {
                const errorMsg = error.message || 'Unknown error';
                console.error(`${sym}: ❌ Error - ${errorMsg}`, error);
                errors.push(`${sym}: ${errorMsg}`);
                symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });
            }
        }

        // Generate summary message
        const successCount = symbolResults.filter(r => r.status === 'success').length;
        const failedCount = symbolResults.filter(r => r.status === 'failed').length;
        const skippedCount = symbolResults.filter(r => r.status === 'skipped').length;

        let message = `完成處理 ${symbols.length} 個標的`;
        if (successCount > 0) message += ` | ✅ 成功: ${successCount}`;
        if (skippedCount > 0) message += ` | ⏭️  跳過: ${skippedCount}`;
        if (failedCount > 0) message += ` | ❌ 失敗: ${failedCount}`;
        message += ` | 共新增 ${totalInserted} 筆資料`;

        return NextResponse.json({
            success: failedCount === 0, // Only success if no failures
            totalInserted,
            symbols,
            symbolResults, // Detailed per-symbol results
            errors: errors.length > 0 ? errors : undefined,
            message
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
