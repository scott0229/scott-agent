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
        });
    } catch (error: any) {
        console.error('Failed to fetch deposits:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const db = await getDb();
        const body = await request.json();

        const { deposit_date, user_id, amount, note, deposit_type } = body;

        if (!deposit_date || !user_id || amount === undefined) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Extract year from deposit_date (Unix timestamp)
        const date = new Date(deposit_date * 1000);
        const year = date.getFullYear();

        const result = await db
            .prepare(
                `INSERT INTO DEPOSITS (deposit_date, user_id, amount, year, note, deposit_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
            )
            .bind(deposit_date, user_id, amount, year, note || null, deposit_type || 'cash')
            .run();

        if (!result.success) {
            throw new Error('Failed to create deposit record');
        }

        return NextResponse.json({
            success: true,
            id: result.meta.last_row_id,
        });
    } catch (error: any) {
        console.error('Failed to create deposit:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
