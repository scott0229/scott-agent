import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function isAdmin(role?: string) {
    return role === 'admin' || role === 'manager';
}

export async function GET(request: NextRequest) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const category = request.nextUrl.searchParams.get('category');
        const search = request.nextUrl.searchParams.get('search');

        const conditions: string[] = [];
        const params: any[] = [];

        if (category && category !== 'All') {
            conditions.push('category = ?');
            params.push(category);
        }
        if (search) {
            conditions.push('(title LIKE ? OR content LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        // Pull content too so we can extract a video URL for the list card's
        // inline preview; it's stripped from the response below to keep the
        // payload lean.
        const results = await db.prepare(`
            SELECT id, title, category, tags, published_at, author_id, created_at, updated_at, content
            FROM blog_posts
            ${whereClause}
            ORDER BY created_at DESC
        `).bind(...params).all();

        const posts = (results.results || []).map((p: any) => {
            const { content, ...rest } = p;
            // First <source src> or <video src> in the post body — used by the
            // list card to show a small inline player for 影片 posts.
            const m = typeof content === 'string'
                ? content.match(/<(?:source|video)[^>]*\ssrc=["']([^"']+)["']/i)
                : null;
            return {
                ...rest,
                tags: safeJsonParse(p.tags, []),
                video_url: m ? m[1] : null,
            };
        });

        return NextResponse.json({ posts });
    } catch (error: any) {
        console.error('Fetch blog posts failed:', error);
        return NextResponse.json({ error: error.message || '讀取失敗' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const body = await request.json();
        const title = (body.title || '').toString().trim();
        const content = (body.content ?? '').toString();
        const category = body.category ? body.category.toString().trim() : null;
        const tags = Array.isArray(body.tags)
            ? body.tags.map((t: any) => t.toString().trim()).filter(Boolean)
            : [];
        const publishedAt = (body.published_at || '').toString().trim() || todayDateString();

        if (!title) {
            return NextResponse.json({ error: '標題不可為空' }, { status: 400 });
        }

        const now = Math.floor(Date.now() / 1000);
        const result = await db.prepare(`
            INSERT INTO blog_posts (title, content, category, tags, published_at, author_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            title,
            content,
            category,
            JSON.stringify(tags),
            publishedAt,
            user.id ?? null,
            now,
            now,
        ).run();

        const id = (result.meta as any)?.last_row_id;
        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Create blog post failed:', error);
        return NextResponse.json({ error: error.message || '建立失敗' }, { status: 500 });
    }
}

function todayDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try {
        return JSON.parse(s) as T;
    } catch {
        return fallback;
    }
}
