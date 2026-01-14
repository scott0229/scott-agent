import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Verify user authentication
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const db = await getDb();

        // Get query parameters for filtering
        const url = new URL(request.url);
        const year = url.searchParams.get('year');
        const userIds = url.searchParams.get('userId'); // Can be comma-separated IDs
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

        // Role-based filtering: customers can only see their own records
        if (user.role === 'customer') {
            query += ` AND d.user_id = ?`;
            params.push(user.id);
        } else {
            // Admin/Manager can filter by multiple users
            if (userIds && userIds !== 'All') {
                const userIdArray = userIds.split(',').map(id => id.trim());
                const placeholders = userIdArray.map(() => '?').join(',');
                query += ` AND d.user_id IN (${placeholders})`;
                params.push(...userIdArray.map(id => parseInt(id)));
            }
        }

        // Year filter
        if (year && year !== 'All') {
            query += ` AND d.year = ?`;
            params.push(parseInt(year));
        }

        // Transaction type filter
        if (transactionType && transactionType !== 'All') {
            query += ` AND d.transaction_type = ?`;
            params.push(transactionType);
        }

        // Deposit type filter
        const depositType = url.searchParams.get('deposit_type');
        if (depositType && depositType !== 'All') {
            if (depositType === 'stock') {
                query += ` AND d.deposit_type IN ('stock', 'both')`;
            } else if (depositType === 'cash') {
                query += ` AND d.deposit_type IN ('cash', 'both')`;
            } else {
                query += ` AND d.deposit_type = ?`;
                params.push(depositType);
            }
        }

        query += ` ORDER BY d.deposit_date DESC, d.id DESC`;

        console.log('Deposits API: Query:', query);
        console.log('Deposits API: Params:', params);

        const { results } = await db.prepare(query).bind(...params).all();
        console.log('Deposits API: Found records:', results.length);
        if (results.length > 0) {
            console.log('Deposits API: First record type:', results[0].deposit_type);
        }

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
        // Permission check: only admin and manager can create deposits
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json(
                { success: false, error: 'Insufficient permissions' },
                { status: 403 }
            );
        }

        const db = await getDb();
        const body = await request.json();

        const { deposit_date, user_id, amount, note, deposit_type, transaction_type } = body;

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
                `INSERT INTO DEPOSITS (deposit_date, user_id, amount, year, note, deposit_type, transaction_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
            )
            .bind(deposit_date, user_id, amount, year, note || null, deposit_type || 'cash', transaction_type || 'deposit')
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
