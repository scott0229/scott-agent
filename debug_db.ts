
import { getDb } from './src/lib/db';

async function main() {
    const db = await getDb();
    const trades = await db.prepare(`
        SELECT id, symbol, quantity, open_date, status, created_at, updated_at, code 
        FROM STOCK_TRADES 
        WHERE symbol = 'QQQ' AND user_id = 'roben.182'
        ORDER BY open_date ASC
    `).all();
    console.log(JSON.stringify(trades, null, 2));
}

main().catch(console.error);
