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
                const { deposit_date, user_id, amount, note, deposit_type, transaction_type, depositor_user_id, depositor_email } = deposit;

                if (!deposit_date || amount === undefined) {
                    skipped++;
                    continue;
                }

                // Verify user exists - prioritize email/string_id lookup over integer ID
                let targetUserId = null;

                // 1. Try by Email
                if (depositor_email) {
                    const u = await db.prepare('SELECT id FROM USERS WHERE email = ?').bind(depositor_email).first();
                    if (u) targetUserId = u.id;
                }

                // 2. Try by String User ID
                if (!targetUserId && depositor_user_id) {
                    const u = await db.prepare('SELECT id FROM USERS WHERE user_id = ?').bind(depositor_user_id).first();
                    if (u) targetUserId = u.id;
                }

                // 3. Fallback to Integer ID (legacy/same-db support)
                if (!targetUserId && user_id) {
                    const u = await db.prepare('SELECT id FROM USERS WHERE id = ?').bind(user_id).first();
                    if (u) targetUserId = u.id;
                }

                if (!targetUserId) {
                    // User doesn't exist, skip this deposit
                    console.log(`Skipping deposit: User not found (ID: ${user_id}, Email: ${depositor_email})`);
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
                    .bind(deposit_date, targetUserId, amount, year, note || null, deposit_type || 'cash', transaction_type || 'deposit')
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
