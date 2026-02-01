import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { clearMarketDataCache } from '@/lib/market-data';
import { clearCache } from '@/lib/response-cache';

// Use environment variable in staging/production, fallback to localhost key
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || 'BJ9X47DS0OLOPYM0';

// Check if a date is a trading day (Mon-Fri, exclude US holidays)
function isTradingDay(date: Date): boolean {
    const day = date.getDay();
    // Weekend
    if (day === 0 || day === 6) return false;

    // TODO: Add US market holidays if needed
    return true;
}

// Get all trading days between two dates
function getTradingDaysBetween(startDate: Date, endDate: Date): Date[] {
    const days: Date[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
        if (isTradingDay(current)) {
            days.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
    }

    return days;
}

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
        const { symbol = 'QQQ', userId } = body;

        const DB = await getDb();

        // Fetch admin user's API key from database (admin user has id = 1 or user_id = 'admin')
        const adminResult = await DB.prepare(
            'SELECT api_key FROM USERS WHERE user_id = ? OR id = ?'
        ).bind('admin', 1).first();

        // Use admin's API key if available, otherwise fall back to environment variable
        const apiKey = (adminResult as any)?.api_key || process.env.ALPHA_VANTAGE_API_KEY || 'BJ9X47DS0OLOPYM0';
        console.log(`Using admin's API key for market data fill-gaps`);


        // Get the latest date in market_prices for this symbol
        const { results: latestResults } = await DB.prepare(
            `SELECT MAX(date) as latest_date FROM market_prices WHERE symbol = ?`
        ).bind(symbol).all();

        let startDate: Date;
        if (latestResults && latestResults.length > 0 && (latestResults[0] as any).latest_date) {
            const latestTimestamp = (latestResults[0] as any).latest_date;
            startDate = new Date(latestTimestamp * 1000);
            // Start from the day after the latest date
            startDate.setDate(startDate.getDate() + 1);
        } else {
            // If no data exists, start from 100 days ago (API limit)
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 100);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get all trading days that need to be filled
        const missingDays = getTradingDaysBetween(startDate, today);

        if (missingDays.length === 0) {
            return NextResponse.json({
                success: true,
                message: '沒有缺失的交易日資料',
                filled: 0
            });
        }

        console.log(`Found ${missingDays.length} missing trading days for ${symbol}`);

        // Fetch from Alpha Vantage
        const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${apiKey}`;

        console.log(`Fetching latest data from Alpha Vantage for ${symbol}...`);
        const response = await fetch(url);

        if (!response.ok) {
            return NextResponse.json({
                success: false,
                error: `Failed to fetch data: HTTP ${response.status}`
            }, { status: 500 });
        }

        const data: AlphaVantageResponse = await response.json();

        // Check for API errors
        if (data['Meta Data'] === undefined) {
            return NextResponse.json({
                success: false,
                error: 'Invalid response from Alpha Vantage',
                details: JSON.stringify(data).substring(0, 200)
            }, { status: 500 });
        }

        const timeSeries = data['Time Series (Daily)'];
        if (!timeSeries) {
            return NextResponse.json({
                success: false,
                error: 'No time series data available'
            }, { status: 500 });
        }

        // Prepare batch insert for missing days
        const insertStmt = DB.prepare(
            `INSERT INTO market_prices (symbol, date, close_price) 
             VALUES (?, ?, ?) 
             ON CONFLICT(symbol, date) DO UPDATE SET close_price=excluded.close_price`
        );

        const batch: any[] = [];
        let filled = 0;

        // Convert missing days to date strings and find matching prices
        for (const missingDay of missingDays) {
            const dateStr = `${missingDay.getFullYear()}-${String(missingDay.getMonth() + 1).padStart(2, '0')}-${String(missingDay.getDate()).padStart(2, '0')}`;

            if (timeSeries[dateStr]) {
                const closePrice = parseFloat(timeSeries[dateStr]['4. close']);
                const timestamp = Date.UTC(missingDay.getFullYear(), missingDay.getMonth(), missingDay.getDate()) / 1000;

                batch.push(insertStmt.bind(symbol, timestamp, closePrice));
                filled++;
                console.log(`Found price for ${dateStr}: $${closePrice}`);
            }
        }

        // Execute batch insert
        if (batch.length > 0) {
            await DB.batch(batch);
            console.log(`Inserted ${batch.length} missing records for ${symbol}`);

            // Clear caches
            clearMarketDataCache(symbol);
            if (userId) {
                clearCache(`benchmark-${userId}-${symbol}`);
            }
        }

        return NextResponse.json({
            success: true,
            symbol,
            totalMissingDays: missingDays.length,
            filled,
            message: `成功補充 ${filled} 筆缺失的交易日資料`
        });

    } catch (error: any) {
        console.error('Fill Gaps API Error:', error);
        return NextResponse.json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
