import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Permission check: only admin and manager can export
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json(
                { success: false, error: 'Insufficient permissions' },
                { status: 403 }
            );
        }

        const db = await getDb();

        // Get query parameters for filtering
        const url = new URL(request.url);
        const year = url.searchParams.get('year');
        const userIds = url.searchParams.get('userId'); // Can be comma-separated
        const transactionType = url.searchParams.get('transaction_type');

        let query = `
      SELECT 
        d.*,
        u.user_id as depositor_user_id,
        u.email as depositor_email
      FROM DEPOSITS d
      LEFT JOIN USERS u ON d.user_id = u.id
      WHERE 1=1
    `;
        const params: any[] = [];

        if (year && year !== 'All') {
            query += ` AND d.year = ?`;
            params.push(parseInt(year));
        }

        // Multi-user filter support
        if (userIds && userIds !== 'All') {
            const userIdArray = userIds.split(',').map(id => id.trim());
            const placeholders = userIdArray.map(() => '?').join(',');
            query += ` AND d.user_id IN (${placeholders})`;
            params.push(...userIdArray.map(id => parseInt(id)));
        }

        // Transaction type filter
        if (transactionType && transactionType !== 'All') {
            query += ` AND d.transaction_type = ?`;
            params.push(transactionType);
        }

        query += ` ORDER BY d.deposit_date DESC, d.id DESC`;

        const { results } = await db.prepare(query).bind(...params).all();

        return NextResponse.json({
            success: true,
            deposits: results || [],
            count: results?.length || 0,
        });
    } catch (error: any) {
        console.error('Failed to export deposits:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
