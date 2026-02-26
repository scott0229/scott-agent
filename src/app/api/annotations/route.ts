import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');
        const userId = searchParams.get('userId');

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        let query = 'SELECT DISTINCT a.* FROM ANNOTATIONS a';
        const params: any[] = [];
        const conditions: string[] = [];

        if (userId) {
            query += ' JOIN ANNOTATION_OWNERS ao ON a.id = ao.annotation_id';
            conditions.push('ao.user_id = ?');
            params.push(userId);
        }

        if (year && year !== 'All') {
            conditions.push('a.year = ?');
            params.push(parseInt(year));
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY a.created_at DESC';

        const { results } = await db.prepare(query).bind(...params).all();

        // Fetch items and owners for each annotation
        const annotationsWithDetails = await Promise.all(
            (results as any[]).map(async (annotation) => {
                const { results: items } = await db.prepare(
                    'SELECT * FROM ANNOTATION_ITEMS WHERE annotation_id = ? ORDER BY id'
                ).bind(annotation.id).all();

                const { results: owners } = await db.prepare(
                    'SELECT * FROM ANNOTATION_OWNERS WHERE annotation_id = ? ORDER BY id'
                ).bind(annotation.id).all();

                return {
                    ...annotation,
                    items: items || [],
                    owners: (owners || []).map((o: any) => ({ owner_id: o.owner_id, user_id: o.user_id })),
                };
            })
        );

        return NextResponse.json({ annotations: annotationsWithDetails });
    } catch (error) {
        console.error('Fetch annotations error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { users: selectedUsers, year, description, items, annotationId: existingId } = body;

        if (!year) {
            return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        let annotationId: number;

        if (existingId) {
            // Update existing annotation
            await db.prepare(`
                UPDATE ANNOTATIONS SET description = ?, updated_at = unixepoch()
                WHERE id = ?
            `).bind(description || null, existingId).run();
            annotationId = existingId;

            // Delete old items and owners
            await db.prepare('DELETE FROM ANNOTATION_ITEMS WHERE annotation_id = ?').bind(annotationId).run();
            await db.prepare('DELETE FROM ANNOTATION_OWNERS WHERE annotation_id = ?').bind(annotationId).run();
        } else {
            // Create new annotation
            const result = await db.prepare(`
                INSERT INTO ANNOTATIONS (user_id, owner_id, year, description)
                VALUES (?, ?, ?, ?)
            `).bind(selectedUsers?.[0]?.userId || '', null, year, description || null).run();
            annotationId = result.meta.last_row_id as number;
        }

        // Insert owners
        if (selectedUsers && selectedUsers.length > 0) {
            for (const u of selectedUsers) {
                await db.prepare(`
                    INSERT INTO ANNOTATION_OWNERS (annotation_id, owner_id, user_id)
                    VALUES (?, ?, ?)
                `).bind(annotationId, u.ownerId, u.userId).run();
            }
        }

        // Insert items
        if (items && items.length > 0) {
            for (const item of items) {
                await db.prepare(`
                    INSERT INTO ANNOTATION_ITEMS (annotation_id, symbol, amount)
                    VALUES (?, ?, ?)
                `).bind(annotationId, item.symbol, item.amount || null).run();
            }
        }

        return NextResponse.json({ success: true, id: annotationId });
    } catch (error: any) {
        console.error('Create/Update annotation error:', error);
        return NextResponse.json({ error: error.message || '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: '缺少 annotation ID' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        const result = await db.prepare('DELETE FROM ANNOTATIONS WHERE id = ?')
            .bind(id)
            .run();

        if (result.meta.changes === 0) {
            return NextResponse.json({ error: '找不到該筆註解' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete annotation error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
