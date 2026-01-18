
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'edge';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { symbol, date, price } = body;

        if (!symbol || !date || price === undefined) {
            return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
        }

        const DB = await getDb();

        // Ensure date is treated as UTC midnight if passed as a simple timestamp or YYYY-MM-DD
        // Assuming frontend sends a clean UTC midnight timestamp (seconds)

        await DB.prepare(
            `INSERT INTO market_prices (symbol, date, close_price) 
             VALUES (?, ?, ?) 
             ON CONFLICT(symbol, date) DO UPDATE SET close_price=excluded.close_price`
        )
            .bind(symbol, date, price)
            .run();

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Failed to save market data:', error);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const mode = searchParams.get('mode');
        const symbol = searchParams.get('symbol');

        const DB = await getDb();

        if (mode === 'all') {
            if (!symbol) {
                return NextResponse.json({ success: false, error: 'Symbol is required for bulk deletion' }, { status: 400 });
            }

            const result = await DB.prepare('DELETE FROM market_prices WHERE symbol = ?').bind(symbol).run();
            return NextResponse.json({ success: true, deleted: result.meta.changes });
        }

        const date = searchParams.get('date');

        if (!symbol || !date) {
            return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
        }

        await DB.prepare('DELETE FROM market_prices WHERE symbol = ? AND date = ?')
            .bind(symbol, date)
            .run();

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Failed to delete market data:', error);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
