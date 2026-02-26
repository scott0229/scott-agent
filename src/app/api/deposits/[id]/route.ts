import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        // Permission check: only admin and manager can edit deposits
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json(
                { success: false, error: 'Insufficient permissions' },
                { status: 403 }
            );
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const body = await request.json();
        const depositId = params.id;

        const { deposit_date, user_id, amount, note, deposit_type, transaction_type } = body;

        if (!deposit_date || !user_id || amount === undefined) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Extract year from deposit_date
        const date = new Date(deposit_date * 1000);
        const year = date.getFullYear();

        const result = await db
            .prepare(
                `UPDATE DEPOSITS 
         SET deposit_date = ?, user_id = ?, amount = ?, year = ?, note = ?, deposit_type = ?, transaction_type = ?, updated_at = unixepoch()
         WHERE id = ?`
            )
            .bind(deposit_date, user_id, amount, year, note || null, deposit_type || 'cash', transaction_type || 'deposit', depositId)
            .run();

        if (!result.success) {
            throw new Error('Failed to update deposit record');
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Failed to update deposit:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        // Permission check: only admin and manager can delete deposits
        const token = request.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json(
                { success: false, error: 'Insufficient permissions' },
                { status: 403 }
            );
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const depositId = params.id;

        const result = await db
            .prepare(`DELETE FROM DEPOSITS WHERE id = ?`)
            .bind(depositId)
            .run();

        if (!result.success) {
            throw new Error('Failed to delete deposit record');
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Failed to delete deposit:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
