import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const url = new URL(request.url);
        const userId = url.searchParams.get('userId');
        const year = url.searchParams.get('year') || '2025';
        const month = url.searchParams.get('month');

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        // Get detailed data for debugging
        const query = `
            SELECT 
                id,
                strftime('%m', datetime(open_date, 'unixepoch')) as month,
                type,
                final_profit,
                collateral,
                days_held,
                settlement_date,
                open_date,
                (COALESCE(collateral, 0) * COALESCE(days_held, CAST((COALESCE(settlement_date, unixepoch()) - open_date) / 86400 AS INTEGER), 0)) as calculated_capital_flow
            FROM OPTIONS
            WHERE owner_id = ?
            AND strftime('%Y', datetime(open_date, 'unixepoch')) = ?
            ${month ? `AND strftime('%m', datetime(open_date, 'unixepoch')) = ?` : ''}
            ORDER BY open_date DESC;
        `;

        const params = month ? [parseInt(userId), year, month] : [parseInt(userId), year];
        const { results } = await db.prepare(query).bind(...params).all();

        // Calculate aggregates per month
        const monthlyData = new Map();

        (results as any[]).forEach((row: any) => {
            if (!monthlyData.has(row.month)) {
                monthlyData.set(row.month, {
                    month: row.month,
                    total_profit: 0,
                    capital_flow: 0,
                    trades: []
                });
            }

            const data = monthlyData.get(row.month);
            data.total_profit += row.final_profit || 0;
            data.capital_flow += row.calculated_capital_flow || 0;
            data.trades.push({
                id: row.id,
                type: row.type,
                final_profit: row.final_profit,
                collateral: row.collateral,
                days_held: row.days_held,
                calculated_capital_flow: row.calculated_capital_flow
            });
        });

        const summary = Array.from(monthlyData.values()).map((data: any) => ({
            month: data.month,
            total_profit: data.total_profit,
            capital_flow: data.capital_flow,
            capital_efficiency: data.capital_flow > 0 ? (data.total_profit / data.capital_flow) * 100 : 0,
            trade_count: data.trades.length,
            trades: data.trades
        }));

        return NextResponse.json({
            userId,
            year,
            summary,
            raw_results: results
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
