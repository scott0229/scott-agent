import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { customAlphabet } from 'nanoid';

// Generate 5-character uppercase alphanumeric code
const generateCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);

export async function POST(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        // Only allow admin users to run this migration
        if (!user || user.role !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 401 });
        }

        const db = await getDb();

        // Get all stock trades without a code
        const { results: tradesWithoutCode } = await db.prepare(
            'SELECT id FROM STOCK_TRADES WHERE code IS NULL'
        ).all();

        if (!tradesWithoutCode || tradesWithoutCode.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No trades need code generation',
                updated: 0
            });
        }

        let updatedCount = 0;
        const errors: any[] = [];

        // Generate and assign codes for each trade
        for (const trade of tradesWithoutCode) {
            try {
                let code = generateCode();
                let isUnique = false;
                let attempts = 0;
                const maxAttempts = 20;

                // Ensure code is unique
                while (!isUnique && attempts < maxAttempts) {
                    const existing = await db.prepare('SELECT id FROM STOCK_TRADES WHERE code = ?').bind(code).first();
                    if (!existing) {
                        isUnique = true;
                    } else {
                        code = generateCode();
                        attempts++;
                    }
                }

                if (!isUnique) {
                    errors.push({ id: trade.id, error: 'Failed to generate unique code' });
                    continue;
                }

                // Update the trade with the generated code
                await db.prepare('UPDATE STOCK_TRADES SET code = ? WHERE id = ?')
                    .bind(code, trade.id)
                    .run();

                updatedCount++;
            } catch (error: any) {
                errors.push({ id: trade.id, error: error.message });
            }
        }

        return NextResponse.json({
            success: true,
            message: `Successfully generated codes for ${updatedCount} trades`,
            updated: updatedCount,
            total: tradesWithoutCode.length,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error: any) {
        console.error('Backfill codes error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
