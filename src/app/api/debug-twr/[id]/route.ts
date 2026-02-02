import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { calculateUserTwr } from '@/lib/twr';
import { getMarketData } from '@/lib/market-data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = parseInt(params.id);
        const db = await getDb();
        const currentYear = new Date().getFullYear();

        // Get equity records
        const { results: equityRecords } = await db.prepare(`
            SELECT date, net_equity, deposit, cash_balance
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ?
            ORDER BY date ASC
        `).bind(userId, currentYear).all();

        // Get user
        const userRecord = await db.prepare(`
            SELECT id, user_id, email, initial_cost, year
            FROM USERS
            WHERE id = ?
        `).bind(userId).first();

        // Method 1: Report API method (current implementation)
        const { results: deposits1 } = await db.prepare(`
            SELECT date as deposit_date, deposit as amount
            FROM DAILY_NET_EQUITY
            WHERE user_id = ? AND year = ? AND deposit != 0
            ORDER BY date ASC
        `).bind(userId, currentYear).all();

        const depositMap1 = new Map();
        (deposits1 || []).forEach((d: any) => {
            const dateObj = new Date(d.deposit_date * 1000);
            const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
            depositMap1.set(midnight, (depositMap1.get(midnight) || 0) + d.amount);
        });

        // Method 2: Performance overview method
        const uEq = equityRecords || [];
        const uDep = uEq.filter((r: any) => r.deposit && r.deposit !== 0).map((r: any) => ({
            deposit_date: r.date,
            amount: Math.abs(r.deposit),
            transaction_type: r.deposit > 0 ? 'deposit' : 'withdrawal'
        }));

        // Use calculateUserTwr to get the "correct" calculation
        const startOfYear = new Date(Date.UTC(currentYear, 0, 1)).getTime() / 1000;
        const prevYearDec31 = new Date(Date.UTC(currentYear - 1, 11, 31)).getTime() / 1000;
        const endOfYear = Math.floor(Date.now() / 1000);

        let qqqData: any[] = [];
        let qldData: any[] = [];
        try {
            const [qData, lData] = await Promise.all([
                getMarketData('QQQ', startOfYear - 86400 * 5, endOfYear),
                getMarketData('QLD', startOfYear - 86400 * 5, endOfYear)
            ]);
            qqqData = qData;
            qldData = lData;
        } catch (error) {
            console.error('Failed to fetch market data:', error);
        }

        const benchStartDate = prevYearDec31;
        const twrResult = calculateUserTwr(
            uEq as any,
            uDep as any,
            (userRecord?.initial_cost as number) || 0,
            benchStartDate,
            qqqData,
            qldData
        );

        return NextResponse.json({
            success: true,
            data: {
                userId,
                currentYear,
                equityRecordsCount: uEq.length,
                deposits1: Array.from(depositMap1.entries()).map(([date, amount]) => ({
                    date: new Date(date * 1000).toISOString().split('T')[0],
                    amount
                })),
                deposits2: uDep.map((d: any) => ({
                    date: new Date(d.deposit_date * 1000).toISOString().split('T')[0],
                    amount: d.amount,
                    transaction_type: d.transaction_type
                })),
                twrStats: twrResult.summary.stats,
                firstEquityRecord: uEq[0],
                lastEquityRecord: uEq[uEq.length - 1]
            }
        });

    } catch (error: any) {
        console.error('Debug error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
