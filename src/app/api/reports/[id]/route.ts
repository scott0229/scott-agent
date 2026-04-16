import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> } // use Promise for App Router params
) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const resolvedParams = await context.params;
        const id = parseInt(resolvedParams.id, 10);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const record = await db.prepare(
            'SELECT bucket_key, filename FROM report_archives WHERE id = ?'
        ).bind(id).first<{ bucket_key: string, filename: string }>();

        if (!record) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        const { env } = await getCloudflareContext();
        if (!env || !env.R2) {
            return NextResponse.json({ error: 'R2 storage not configured' }, { status: 500 });
        }

        const object = await env.R2.get(record.bucket_key);
        if (!object) {
            return NextResponse.json({ error: 'File not found in R2' }, { status: 404 });
        }

        const headers = new Headers();
        headers.set('Content-Type', object.httpMetadata?.contentType || 'text/html; charset=utf-8');

        return new NextResponse(object.body as unknown as BodyInit, {
            headers,
        });

    } catch (error: any) {
        console.error('Fetch report HTML failed:', error);
        return NextResponse.json({ error: 'Failed to retrieve report' }, { status: 500 });
    }
}
