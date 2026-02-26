import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        // Check permissions
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only admin/manager or the user themselves can export
        if (user.role === 'customer' && user.id !== Number(userId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (!userId) {
            return NextResponse.json({ error: 'User ID required' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const records = await db.prepare(`
            SELECT date, net_equity, interest
            FROM DAILY_NET_EQUITY 
            WHERE user_id = ? 
            ORDER BY date ASC
        `).bind(userId).all();

        // Convert to CSV
        const csvRows = ['Date,NetEquity,Interest'];
        (records.results as any[]).forEach(r => {
            const date = new Date(r.date * 1000);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            csvRows.push(`${dateStr},${r.net_equity},${r.interest || 0}`);
        });

        const csvContent = "\uFEFF" + csvRows.join('\n'); // Add BOM for Excel compatibility

        return new NextResponse(csvContent, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="net_equity_${userId}.csv"`,
            },
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
