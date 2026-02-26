import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // 1. Create a dummy user
        const { meta: userMeta } = await db.prepare("INSERT INTO USERS (email, password, role, year) VALUES ('test_cascade@example.com', 'pass', 'customer', 9999)").run();
        const userId = userMeta.last_row_id;

        // 2. Create 3 dummy options
        await db.prepare("INSERT INTO OPTIONS (owner_id, underlying, type, strike_price, open_date, year) VALUES (?, 'AAPL', 'call', 100, 1234567890, 9999)").bind(userId).run();
        await db.prepare("INSERT INTO OPTIONS (owner_id, underlying, type, strike_price, open_date, year) VALUES (?, 'GOOGL', 'put', 200, 1234567890, 9999)").bind(userId).run();
        await db.prepare("INSERT INTO OPTIONS (owner_id, underlying, type, strike_price, open_date, year) VALUES (?, 'MSFT', 'call', 300, 1234567890, 9999)").bind(userId).run();

        // 3. Delete the user
        const result = await db.prepare("DELETE FROM USERS WHERE id = ?").bind(userId).run();

        // 4. Check if options are gone
        const { count } = await db.prepare("SELECT count(*) as count FROM OPTIONS WHERE YEAR = 9999").first();

        // 5. Clean up any remnants (if cascade failed)
        await db.prepare("DELETE FROM OPTIONS WHERE year = 9999").run();
        await db.prepare("DELETE FROM USERS WHERE year = 9999").run(); // Should be empty already

        return NextResponse.json({
            changes: result.meta.changes,
            remainingOptions: count,
            explanation: "If changes > 1, then CASCADE is counted (or manual delete worked). If remainingOptions == 0, then cleanup succeeded."
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
