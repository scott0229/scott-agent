import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: Request) {
    try {
        const DB = await getDb();

        // Count total records by symbol
        const { results: countResults } = await DB.prepare(
            `SELECT symbol, COUNT(*) as count FROM market_prices GROUP BY symbol`
        ).all();

        // Get sample QQQ data
        const { results: qqqResults } = await DB.prepare(
            `SELECT date, close_price FROM market_prices 
             WHERE symbol = 'QQQ' 
             ORDER BY date DESC 
             LIMIT 10`
        ).all();

        // Get date range
        const { results: rangeResults } = await DB.prepare(
            `SELECT 
                symbol,
                MIN(date) as min_date,
                MAX(date) as max_date
             FROM market_prices 
             GROUP BY symbol`
        ).all();

        return NextResponse.json({
            success: true,
            counts: countResults,
            sampleQQQ: qqqResults,
            dateRanges: rangeResults
        });

    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
