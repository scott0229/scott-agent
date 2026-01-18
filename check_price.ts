import { getDb } from './src/lib/db';

async function check() {
    const db = await getDb();
    // 2026-01-01
    const start = Math.floor(new Date('2026-01-01').getTime() / 1000);
    const end = Math.floor(new Date('2026-02-01').getTime() / 1000);

    const { results } = await db.prepare(
        `SELECT date, symbol, close_price 
         FROM market_prices 
         WHERE symbol = 'QQQ' AND date >= ? AND date <= ?
         ORDER BY date ASC`
    )
        .bind(start, end)
        .all();

    console.log('QQQ Prices Jan 2026:');
    if (Array.isArray(results)) {
        results.forEach((r: any) => {
            console.log(`${new Date(r.date * 1000).toLocaleDateString()}: ${r.close_price}`);
        });
    } else {
        console.log('No results or invalid format', results);
    }
}

check().catch(console.error);
