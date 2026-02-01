import { getDb } from './src/lib/db.js';

async function checkDatabase() {
    const db = await getDb();

    console.log('Checking market_prices table...\n');

    // Count total records
    const { results: countResults } = await db.prepare(
        `SELECT symbol, COUNT(*) as count FROM market_prices GROUP BY symbol`
    ).all();

    console.log('=== Record Counts by Symbol ===');
    if (countResults && countResults.length > 0) {
        countResults.forEach((row) => {
            console.log(`${row.symbol}: ${row.count} records`);
        });
    } else {
        console.log('❌ No records found in market_prices table');
    }

    // Get some sample data for QQQ
    console.log('\n=== Sample QQQ Data (Last 10 records) ===');
    const { results: qqqResults } = await db.prepare(
        `SELECT date, close_price FROM market_prices 
         WHERE symbol = 'QQQ' 
         ORDER BY date DESC 
         LIMIT 10`
    ).all();

    if (qqqResults && qqqResults.length > 0) {
        qqqResults.forEach((row) => {
            const date = new Date(row.date * 1000);
            console.log(`${date.toISOString().split('T')[0]}: $${row.close_price}`);
        });
    } else {
        console.log('❌ No QQQ data found');
    }

    // Check date range
    console.log('\n=== Date Range ===');
    const { results: rangeResults } = await db.prepare(
        `SELECT 
            symbol,
            MIN(date) as min_date,
            MAX(date) as max_date
         FROM market_prices 
         GROUP BY symbol`
    ).all();

    if (rangeResults && rangeResults.length > 0) {
        rangeResults.forEach((row) => {
            const minDate = new Date(row.min_date * 1000);
            const maxDate = new Date(row.max_date * 1000);
            console.log(`${row.symbol}: ${minDate.toISOString().split('T')[0]} to ${maxDate.toISOString().split('T')[0]}`);
        });
    }
}

checkDatabase().catch(console.error);
