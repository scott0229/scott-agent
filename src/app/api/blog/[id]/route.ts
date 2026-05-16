import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function isAdmin(role?: string) {
    return role === 'admin' || role === 'manager';
}

function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try {
        return JSON.parse(s) as T;
    } catch {
        return fallback;
    }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) {
            return NextResponse.json({ error: '無效的 ID' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const post = await db.prepare(`
            SELECT id, title, content, category, tags, published_at, author_id, created_at, updated_at
            FROM blog_posts WHERE id = ?
        `).bind(id).first();

        if (!post) {
            return NextResponse.json({ error: '文章不存在' }, { status: 404 });
        }

        return NextResponse.json({
            post: {
                ...post,
                tags: safeJsonParse((post as any).tags, []),
            },
        });
    } catch (error: any) {
        console.error('Fetch blog post failed:', error);
        return NextResponse.json({ error: error.message || '讀取失敗' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) {
            return NextResponse.json({ error: '無效的 ID' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const body = await request.json();

        const fields: string[] = [];
        const values: any[] = [];

        if (typeof body.title === 'string') {
            const t = body.title.trim();
            if (!t) return NextResponse.json({ error: '標題不可為空' }, { status: 400 });
            fields.push('title = ?'); values.push(t);
        }
        if (typeof body.content === 'string') {
            fields.push('content = ?'); values.push(body.content);
        }
        if ('category' in body) {
            const c = body.category ? body.category.toString().trim() : null;
            fields.push('category = ?'); values.push(c || null);
        }
        if (Array.isArray(body.tags)) {
            const tags = body.tags.map((t: any) => t.toString().trim()).filter(Boolean);
            fields.push('tags = ?'); values.push(JSON.stringify(tags));
        }
        if (typeof body.published_at === 'string' && body.published_at.trim()) {
            fields.push('published_at = ?'); values.push(body.published_at.trim());
        }

        if (fields.length === 0) {
            return NextResponse.json({ success: true });
        }

        fields.push('updated_at = ?');
        values.push(Math.floor(Date.now() / 1000));
        values.push(id);

        await db.prepare(`UPDATE blog_posts SET ${fields.join(', ')} WHERE id = ?`)
            .bind(...values)
            .run();

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Update blog post failed:', error);
        return NextResponse.json({ error: error.message || '更新失敗' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) {
            return NextResponse.json({ error: '無效的 ID' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        await db.prepare('DELETE FROM blog_posts WHERE id = ?').bind(id).run();

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Delete blog post failed:', error);
        return NextResponse.json({ error: error.message || '刪除失敗' }, { status: 500 });
    }
}
