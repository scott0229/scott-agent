import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
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

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        // Get query parameters for filtering
        const url = new URL(request.url);
        const year = url.searchParams.get('year');
        const userIds = url.searchParams.get('userId'); // Can be comma-separated IDs
        const transactionType = url.searchParams.get('transaction_type');

        // Query DAILY_NET_EQUITY where deposit is not 0
        let query = `
      SELECT 
        d.id,
        d.user_id,
        d.date as deposit_date,
        ABS(d.deposit) as amount,
        d.year,
        CASE WHEN d.deposit > 0 THEN 'deposit' ELSE 'withdrawal' END as transaction_type,
        'cash' as deposit_type,
        NULL as note,
        u.user_id as depositor_user_id,
        u.email as depositor_email
      FROM DAILY_NET_EQUITY d
      LEFT JOIN USERS u ON d.user_id = u.id
      WHERE d.deposit IS NOT NULL AND d.deposit != 0
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
            if (transactionType === 'deposit') {
                query += ` AND d.deposit > 0`;
            } else if (transactionType === 'withdrawal') {
                query += ` AND d.deposit < 0`;
            }
        }

        // Deposit type filter - Ignored as we only have 'cash' equivalent (part of net equity)
        // We could strictly allow only 'cash' or 'All'
        const depositType = url.searchParams.get('deposit_type');
        if (depositType && depositType !== 'All' && depositType !== 'cash') {
            // If they ask for 'stock', we return nothing as net equity deposits are treated as cash/value
            // Or we just ignore it. Let's strictly return empty if they want stock specifically, 
            // assuming migration merged everything into value.
            if (depositType === 'stock') {
                // return empty
                return NextResponse.json({
                    success: true,
                    deposits: [],
                });
            }
        }

        query += ` ORDER BY d.date DESC, d.id DESC`;

        console.log('Deposits API (Net Equity Source): Query:', query);
        console.log('Deposits API (Net Equity Source): Params:', params);

        const { results } = await db.prepare(query).bind(...params).all();
        console.log('Deposits API: Found records:', results.length);

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

// POST endpoint removed as deposits are now managed via Net Equity API

