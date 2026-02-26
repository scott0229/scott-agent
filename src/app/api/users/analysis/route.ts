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
        const year = url.searchParams.get('year');

        if (!userId || !year) {
            return NextResponse.json(
                { error: 'Missing userId or year parameter' },
                { status: 400 }
            );
        }

        // Get detailed analysis for each month
        const analysisQuery = `
            SELECT 
                strftime('%m', datetime(open_date, 'unixepoch')) as month,
                type,
                COUNT(*) as total_trades,
                COUNT(CASE WHEN final_profit > 0 THEN 1 END) as winning_trades,
                AVG(COALESCE(delta, 0)) as avg_delta,
                AVG(COALESCE(iv, 0)) as avg_iv,
                SUM(COALESCE(final_profit, 0)) as total_profit,
                SUM(COALESCE(collateral, 0) * COALESCE(days_held, CAST((COALESCE(settlement_date, unixepoch()) - open_date) / 86400 AS INTEGER), 0)) as capital_flow
            FROM OPTIONS
            WHERE owner_id = ? 
            AND strftime('%Y', datetime(open_date, 'unixepoch')) = ?
            GROUP BY month, type
        `;

        const { results } = await db.prepare(analysisQuery).bind(parseInt(userId), year).all();

        // Aggregate by month
        const monthlyData = new Map();

        for (let i = 1; i <= 12; i++) {
            const monthStr = i.toString().padStart(2, '0');
            monthlyData.set(monthStr, {
                month: monthStr,
                put_total: 0,
                put_winning: 0,
                call_total: 0,
                call_winning: 0,
                total_trades: 0,
                winning_trades: 0,
                put_delta_sum: 0,
                put_delta_count: 0,
                call_delta_sum: 0,
                call_delta_count: 0,
                delta_sum: 0,
                delta_count: 0,
                iv_sum: 0,
                iv_count: 0,
                total_profit: 0,
                capital_flow: 0
            });
        }

        // Process results
        (results as any[]).forEach((row: any) => {
            const data = monthlyData.get(row.month);
            if (!data) return;

            if (row.type === 'PUT') {
                data.put_total += row.total_trades;
                data.put_winning += row.winning_trades;
                data.put_delta_sum += row.avg_delta * row.total_trades;
                data.put_delta_count += row.total_trades;
            } else if (row.type === 'CALL') {
                data.call_total += row.total_trades;
                data.call_winning += row.winning_trades;
                data.call_delta_sum += row.avg_delta * row.total_trades;
                data.call_delta_count += row.total_trades;
            }

            data.total_trades += row.total_trades;
            data.winning_trades += row.winning_trades;
            data.delta_sum += row.avg_delta * row.total_trades;
            data.delta_count += row.total_trades;
            data.iv_sum += row.avg_iv * row.total_trades;
            data.iv_count += row.total_trades;
            data.total_profit += row.total_profit;
            data.capital_flow += row.capital_flow;
        });

        // Calculate final metrics
        const monthly_analysis = Array.from(monthlyData.values()).map((data: any) => ({
            month: data.month,
            put_win_rate: data.put_total > 0 ? (data.put_winning / data.put_total) * 100 : 0,
            call_win_rate: data.call_total > 0 ? (data.call_winning / data.call_total) * 100 : 0,
            total_win_rate: data.total_trades > 0 ? (data.winning_trades / data.total_trades) * 100 : 0,
            put_delta: data.put_delta_count > 0 ? data.put_delta_sum / data.put_delta_count : 0,
            call_delta: data.call_delta_count > 0 ? data.call_delta_sum / data.call_delta_count : 0,
            total_delta: data.delta_count > 0 ? data.delta_sum / data.delta_count : 0,
            avg_iv: data.iv_count > 0 ? data.iv_sum / data.iv_count : 0,
            capital_efficiency: data.capital_flow > 0 ? (data.total_profit / data.capital_flow) * 100 : 0,
            capital_flow: data.capital_flow
        }));

        return NextResponse.json({
            success: true,
            monthly_analysis
        });
    } catch (error: any) {
        console.error('Failed to fetch analysis:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
