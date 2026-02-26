import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

export const dynamic = 'force-dynamic';

const FEB_11_2026 = 1770768000; // 2026-02-11 00:00:00 UTC

export async function GET(request: NextRequest) {
    try {
        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const results: any = {
            summary: {},
            details: {}
        };

        // 1. DAILY_NET_EQUITY
        const netEquityRecords = await db.prepare(`
            SELECT dne.*, u.user_id, u.email 
            FROM DAILY_NET_EQUITY dne
            LEFT JOIN USERS u ON dne.user_id = u.id
            WHERE dne.date = ?
            ORDER BY u.user_id
        `).bind(FEB_11_2026).all();
        results.details.dailyNetEquity = netEquityRecords.results;
        results.summary.dailyNetEquity = netEquityRecords.results.length;

        // 2. STOCK_TRADES (open_date)
        const stockOpenRecords = await db.prepare(`
            SELECT st.*, u.user_id, u.email 
            FROM STOCK_TRADES st
            LEFT JOIN USERS u ON st.owner_id = u.id
            WHERE st.open_date = ?
            ORDER BY u.user_id
        `).bind(FEB_11_2026).all();
        results.details.stockTradesOpen = stockOpenRecords.results;
        results.summary.stockTradesOpen = stockOpenRecords.results.length;

        // 3. STOCK_TRADES (close_date)
        const stockCloseRecords = await db.prepare(`
            SELECT st.*, u.user_id, u.email 
            FROM STOCK_TRADES st
            LEFT JOIN USERS u ON st.owner_id = u.id
            WHERE st.close_date = ?
            ORDER BY u.user_id
        `).bind(FEB_11_2026).all();
        results.details.stockTradesClose = stockCloseRecords.results;
        results.summary.stockTradesClose = stockCloseRecords.results.length;

        // 4. OPTIONS (open_date)
        const optionsOpenRecords = await db.prepare(`
            SELECT o.*, u.user_id, u.email 
            FROM OPTIONS o
            LEFT JOIN USERS u ON o.owner_id = u.id
            WHERE o.open_date = ?
            ORDER BY u.user_id
        `).bind(FEB_11_2026).all();
        results.details.optionsOpen = optionsOpenRecords.results;
        results.summary.optionsOpen = optionsOpenRecords.results.length;

        // 5. OPTIONS (settlement_date)
        const optionsSettlementRecords = await db.prepare(`
            SELECT o.*, u.user_id, u.email 
            FROM OPTIONS o
            LEFT JOIN USERS u ON o.owner_id = u.id
            WHERE o.settlement_date = ?
            ORDER BY u.user_id
        `).bind(FEB_11_2026).all();
        results.details.optionsSettlement = optionsSettlementRecords.results;
        results.summary.optionsSettlement = optionsSettlementRecords.results.length;

        // 6. MARKET_DATA (optional, may not exist in dev)
        try {
            const marketDataRecords = await db.prepare(`
                SELECT * FROM MARKET_DATA 
                WHERE date = ?
                ORDER BY symbol
            `).bind(FEB_11_2026).all();
            results.details.marketData = marketDataRecords.results;
            results.summary.marketData = marketDataRecords.results.length;
        } catch (e) {
            // Table might not exist
            results.details.marketData = [];
            results.summary.marketData = 0;
        }

        // 總計
        results.summary.total =
            results.summary.dailyNetEquity +
            results.summary.stockTradesOpen +
            results.summary.stockTradesClose +
            results.summary.optionsOpen +
            results.summary.optionsSettlement +
            results.summary.marketData;

        // SCOTT 用戶專查
        const scottUsers = await db.prepare(`
            SELECT id, user_id, email, year FROM USERS 
            WHERE user_id LIKE '%scott%' OR user_id LIKE '%238%'
            ORDER BY year DESC
        `).all();

        results.scottUsers = [];
        for (const user of scottUsers.results as any[]) {
            const latestRecord = await db.prepare(`
                SELECT MAX(date) as latest_date FROM DAILY_NET_EQUITY WHERE user_id = ?
            `).bind(user.id).first();

            let latestDateStr = 'N/A';
            if (latestRecord && latestRecord.latest_date) {
                const date = new Date((latestRecord.latest_date as number) * 1000);
                latestDateStr = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            }

            results.scottUsers.push({
                id: user.id,
                user_id: user.user_id,
                email: user.email,
                year: user.year,
                latest_date: latestRecord?.latest_date || null,
                latest_date_str: latestDateStr
            });
        }

        return NextResponse.json({ success: true, data: results });

    } catch (error: any) {
        console.error('Error checking Feb 11 records:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
