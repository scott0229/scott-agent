import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const db = await getDb();

        // Get query parameters for filtering
        const url = new URL(request.url);
        const year = url.searchParams.get('year');
        const userId = url.searchParams.get('userId');

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

        if (userId) {
            query += ` AND d.user_id = ?`;
            params.push(parseInt(userId));
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
