const { getDb } = require('./src/lib/db');

async function check() {
    const db = await getDb();
    const start = Math.floor(new Date('2026-01-01').getTime() / 1000);
    const end = Math.floor(new Date('2026-02-01').getTime() / 1000);

    const { results } = await db.prepare(
        `SELECT date, symbol, close_price 
         FROM market_prices 
         WHERE symbol = 'QQQ' AND date >= ? AND date <= ?`
    ).bind(start, end).all();

    console.log('QQQ Prices Jan 2026:');
    results.forEach(r => {
        console.log(`${new Date(r.date * 1000).toISOString().split('T')[0]}: ${r.close_price}`);
    });
}

check().catch(console.error);
