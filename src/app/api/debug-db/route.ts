import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const db = await getDb();

        // 1. Create a dummy user
        const { meta: userMeta } = await db.prepare("INSERT INTO USERS (email, password, role, year) VALUES ('test_cascade@example.com', 'pass', 'customer', 9999)").run();
        const userId = userMeta.last_row_id;

        // 2. Create 3 dummy deposits
        await db.prepare("INSERT INTO DEPOSITS (user_id, amount, deposit_date, year) VALUES (?, 100, 1234567890, 9999)").bind(userId).run();
        await db.prepare("INSERT INTO DEPOSITS (user_id, amount, deposit_date, year) VALUES (?, 200, 1234567890, 9999)").bind(userId).run();
        await db.prepare("INSERT INTO DEPOSITS (user_id, amount, deposit_date, year) VALUES (?, 300, 1234567890, 9999)").bind(userId).run();

        // 3. Delete the user
        const result = await db.prepare("DELETE FROM USERS WHERE id = ?").bind(userId).run();

        // 4. Check if deposits are gone
        const { count } = await db.prepare("SELECT count(*) as count FROM DEPOSITS WHERE YEAR = 9999").first();

        // 5. Clean up any remnants (if cascade failed)
        await db.prepare("DELETE FROM DEPOSITS WHERE year = 9999").run();
        await db.prepare("DELETE FROM USERS WHERE year = 9999").run(); // Should be empty already

        return NextResponse.json({
            changes: result.meta.changes,
            remainingDeposits: count,
            explanation: "If changes > 1, then CASCADE is counted. If changes == 1 and remainingDeposits == 0, then CASCADE works but is NOT counted."
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
