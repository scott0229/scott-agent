import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        // Permission check: only admin and manager can import
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
        const { deposits } = body;

        if (!Array.isArray(deposits)) {
            return NextResponse.json(
                { success: false, error: 'Invalid data format' },
                { status: 400 }
            );
        }

        let imported = 0;
        let skipped = 0;

        for (const deposit of deposits) {
            try {
                const { deposit_date, user_id, amount, note, deposit_type, transaction_type } = deposit;

                if (!deposit_date || !user_id || amount === undefined) {
                    skipped++;
                    continue;
                }

                // Check if user exists
                const userCheck = await db
                    .prepare(`SELECT id FROM USERS WHERE id = ?`)
                    .bind(user_id)
                    .first();

                if (!userCheck) {
                    // User doesn't exist, skip this deposit
                    skipped++;
                    continue;
                }

                // Extract year from deposit_date (Unix timestamp)
                const date = new Date(deposit_date * 1000);
                const year = date.getFullYear();

                await db
                    .prepare(
                        `INSERT INTO DEPOSITS (deposit_date, user_id, amount, year, note, deposit_type, transaction_type, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                    )
                    .bind(deposit_date, user_id, amount, year, note || null, deposit_type || 'cash', transaction_type || 'deposit')
                    .run();

                imported++;
            } catch (err) {
                console.error('Failed to import deposit:', err);
                skipped++;
            }
        }

        return NextResponse.json({
            success: true,
            imported,
            skipped,
        });
    } catch (error: any) {
        console.error('Failed to import deposits:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
