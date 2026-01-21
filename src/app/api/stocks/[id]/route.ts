
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function PUT(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();

        const {
            id,
            symbol,
            status,
            open_date,
            close_date,
            open_price,
            close_price,
            quantity
        } = body;

        if (!id || !symbol || !open_date || !open_price || !quantity) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const db = await getDb();

        await db.prepare(`
            UPDATE STOCK_TRADES SET
                symbol = ?, status = ?, open_date = ?, close_date = ?,
                open_price = ?, close_price = ?, quantity = ?,
                updated_at = unixepoch()
            WHERE id = ?
        `).bind(
            symbol,
            status,
            open_date,
            close_date || null,
            open_price,
            close_price || null,
            quantity,
            id
        ).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update stock trade error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // params.id comes from the route context, but Next 13+ App Router in api/stocks/[id]/route.ts 
        // usually passes params as the second argument.
        const id = params.id;

        if (!id) {
            return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
        }

        const db = await getDb();
        await db.prepare('DELETE FROM STOCK_TRADES WHERE id = ?').bind(id).run();

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Delete stock trade error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
