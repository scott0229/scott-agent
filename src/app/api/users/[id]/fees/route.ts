import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// Helper to check for admin or manager role
async function checkAdminOrManager(req: NextRequest) {
    const token = req.cookies.get('token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || !['admin', 'manager'].includes(payload.role)) {
        return null;
    }
    return payload;
}

export const dynamic = 'force-dynamic';

// GET: Fetch monthly fees for a user in a specific year
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await checkAdminOrManager(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');

        if (!year) {
            return NextResponse.json({ error: '缺少年份參數' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Fetch fees data for all 12 months
        const { results } = await db.prepare(
            'SELECT month, amount FROM monthly_fees WHERE user_id = ? AND year = ? ORDER BY month ASC'
        ).bind(id, parseInt(year)).all();

        // Create array with all 12 months (fill missing months with 0)
        const fees = Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const found = (results as any[]).find((r: any) => r.month === month);
            return {
                month,
                amount: found?.amount || 0
            };
        });

        return NextResponse.json({ fees });
    } catch (error) {
        console.error('Get fees error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

// PUT: Update monthly fees for a user
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await checkAdminOrManager(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { id } = await params;
        const { year, fees } = await req.json() as {
            year: number;
            fees: { month: number; amount: number }[];
        };

        if (!year || !fees) {
            return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Use UPSERT (INSERT OR REPLACE) for each month
        for (const { month, amount } of fees) {
            await db.prepare(
                `INSERT INTO monthly_fees (user_id, year, month, amount, updated_at)
                 VALUES (?, ?, ?, ?, unixepoch())
                 ON CONFLICT(user_id, year, month) 
                 DO UPDATE SET amount = ?, updated_at = unixepoch()`
            ).bind(id, year, month, amount, amount).run();
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update fees error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
