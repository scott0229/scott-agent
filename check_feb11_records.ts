/**
 * 檢查資料庫中所有 2/11 (2026-02-11) 的記錄
 * Unix timestamp: 1770768000 (UTC 00:00:00)
 */

import { getDb } from './src/lib/db';

const FEB_11_2026 = 1770768000; // 2026-02-11 00:00:00 UTC

async function checkFeb11Records() {
    const db = await getDb();

    console.log('='.repeat(80));
    console.log('查詢 2026-02-11 (timestamp: 1770768000) 的所有記錄');
    console.log('='.repeat(80));
    console.log('');

    // 1. 檢查 DAILY_NET_EQUITY 表
    console.log('1. DAILY_NET_EQUITY 表:');
    console.log('-'.repeat(80));
    const netEquityRecords = await db.prepare(`
        SELECT dne.*, u.user_id, u.email 
        FROM DAILY_NET_EQUITY dne
        LEFT JOIN USERS u ON dne.user_id = u.id
        WHERE dne.date = ?
        ORDER BY u.user_id
    `).bind(FEB_11_2026).all();

    if (netEquityRecords.results.length > 0) {
        console.log(`找到 ${netEquityRecords.results.length} 筆記錄:`);
        netEquityRecords.results.forEach((record: any) => {
            console.log(`  - ID: ${record.id}, User: ${record.user_id || record.email}, NetEquity: ${record.net_equity}, Cash: ${record.cash_balance}`);
        });
    } else {
        console.log('  無記錄');
    }
    console.log('');

    // 2. 檢查 STOCK_TRADES 表 (open_date = 2/11)
    console.log('2. STOCK_TRADES 表 (open_date = 2/11):');
    console.log('-'.repeat(80));
    const stockOpenRecords = await db.prepare(`
        SELECT st.*, u.user_id, u.email 
        FROM STOCK_TRADES st
        LEFT JOIN USERS u ON st.owner_id = u.id
        WHERE st.open_date = ?
        ORDER BY u.user_id
    `).bind(FEB_11_2026).all();

    if (stockOpenRecords.results.length > 0) {
        console.log(`找到 ${stockOpenRecords.results.length} 筆記錄:`);
        stockOpenRecords.results.forEach((record: any) => {
            console.log(`  - ID: ${record.id}, User: ${record.user_id || record.email}, Symbol: ${record.symbol}, Qty: ${record.quantity}, Status: ${record.status}`);
        });
    } else {
        console.log('  無記錄');
    }
    console.log('');

    // 3. 檢查 STOCK_TRADES 表 (close_date = 2/11)
    console.log('3. STOCK_TRADES 表 (close_date = 2/11):');
    console.log('-'.repeat(80));
    const stockCloseRecords = await db.prepare(`
        SELECT st.*, u.user_id, u.email 
        FROM STOCK_TRADES st
        LEFT JOIN USERS u ON st.owner_id = u.id
        WHERE st.close_date = ?
        ORDER BY u.user_id
    `).bind(FEB_11_2026).all();

    if (stockCloseRecords.results.length > 0) {
        console.log(`找到 ${stockCloseRecords.results.length} 筆記錄:`);
        stockCloseRecords.results.forEach((record: any) => {
            console.log(`  - ID: ${record.id}, User: ${record.user_id || record.email}, Symbol: ${record.symbol}, Qty: ${record.quantity}, Status: ${record.status}`);
        });
    } else {
        console.log('  無記錄');
    }
    console.log('');

    // 4. 檢查 OPTIONS 表 (open_date = 2/11)
    console.log('4. OPTIONS 表 (open_date = 2/11):');
    console.log('-'.repeat(80));
    const optionsOpenRecords = await db.prepare(`
        SELECT o.*, u.user_id, u.email 
        FROM OPTIONS o
        LEFT JOIN USERS u ON o.owner_id = u.id
        WHERE o.open_date = ?
        ORDER BY u.user_id
    `).bind(FEB_11_2026).all();

    if (optionsOpenRecords.results.length > 0) {
        console.log(`找到 ${optionsOpenRecords.results.length} 筆記錄:`);
        optionsOpenRecords.results.forEach((record: any) => {
            console.log(`  - ID: ${record.id}, User: ${record.user_id || record.email}, Underlying: ${record.underlying}, Strike: ${record.strike_price}, Type: ${record.type}, Op: ${record.operation}`);
        });
    } else {
        console.log('  無記錄');
    }
    console.log('');

    // 5. 檢查 OPTIONS 表 (settlement_date = 2/11)
    console.log('5. OPTIONS 表 (settlement_date = 2/11):');
    console.log('-'.repeat(80));
    const optionsSettlementRecords = await db.prepare(`
        SELECT o.*, u.user_id, u.email 
        FROM OPTIONS o
        LEFT JOIN USERS u ON o.owner_id = u.id
        WHERE o.settlement_date = ?
        ORDER BY u.user_id
    `).bind(FEB_11_2026).all();

    if (optionsSettlementRecords.results.length > 0) {
        console.log(`找到 ${optionsSettlementRecords.results.length} 筆記錄:`);
        optionsSettlementRecords.results.forEach((record: any) => {
            console.log(`  - ID: ${record.id}, User: ${record.user_id || record.email}, Underlying: ${record.underlying}, Strike: ${record.strike_price}, Type: ${record.type}, Op: ${record.operation}`);
        });
    } else {
        console.log('  無記錄');
    }
    console.log('');

    // 6. 檢查 MARKET_DATA 表
    console.log('6. MARKET_DATA 表:');
    console.log('-'.repeat(80));
    const marketDataRecords = await db.prepare(`
        SELECT * FROM MARKET_DATA 
        WHERE date = ?
        ORDER BY symbol
    `).bind(FEB_11_2026).all();

    if (marketDataRecords.results.length > 0) {
        console.log(`找到 ${marketDataRecords.results.length} 筆記錄:`);
        marketDataRecords.results.forEach((record: any) => {
            console.log(`  - Symbol: ${record.symbol}, Close: ${record.close_price}`);
        });
    } else {
        console.log('  無記錄');
    }
    console.log('');

    // 總結
    console.log('='.repeat(80));
    console.log('總結:');
    console.log('-'.repeat(80));
    const totalRecords =
        netEquityRecords.results.length +
        stockOpenRecords.results.length +
        stockCloseRecords.results.length +
        optionsOpenRecords.results.length +
        optionsSettlementRecords.results.length +
        marketDataRecords.results.length;

    console.log(`總共找到 ${totalRecords} 筆 2/11 的記錄`);
    console.log(`  - DAILY_NET_EQUITY: ${netEquityRecords.results.length}`);
    console.log(`  - STOCK_TRADES (open): ${stockOpenRecords.results.length}`);
    console.log(`  - STOCK_TRADES (close): ${stockCloseRecords.results.length}`);
    console.log(`  - OPTIONS (open): ${optionsOpenRecords.results.length}`);
    console.log(`  - OPTIONS (settlement): ${optionsSettlementRecords.results.length}`);
    console.log(`  - MARKET_DATA: ${marketDataRecords.results.length}`);
    console.log('='.repeat(80));

    // 特別檢查 SCOTT 用戶
    console.log('');
    console.log('='.repeat(80));
    console.log('SCOTT 用戶專查:');
    console.log('-'.repeat(80));

    const scottUser = await db.prepare(`
        SELECT id, user_id, email FROM USERS 
        WHERE user_id LIKE '%scott%' OR user_id LIKE '%238%'
        ORDER BY year DESC
    `).all();

    if (scottUser.results.length > 0) {
        console.log(`找到 SCOTT 相關用戶:`);
        for (const user of scottUser.results as any[]) {
            console.log(`  - ID: ${user.id}, UserID: ${user.user_id}, Email: ${user.email}`);

            // 查詢該用戶的最新記錄
            const latestRecord = await db.prepare(`
                SELECT MAX(date) as latest_date FROM DAILY_NET_EQUITY WHERE user_id = ?
            `).bind(user.id).first();

            if (latestRecord && latestRecord.latest_date) {
                const date = new Date((latestRecord.latest_date as number) * 1000);
                const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                console.log(`    最新記錄日期: ${dateStr} (timestamp: ${latestRecord.latest_date})`);
            } else {
                console.log(`    無淨值記錄`);
            }
        }
    }
    console.log('='.repeat(80));
}

checkFeb11Records().catch(console.error);
