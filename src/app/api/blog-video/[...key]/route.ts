import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

// Stream a video (or any large binary) out of the production R2 bucket.
// Gated to admin/manager so it mirrors the rest of /blog. Supports HTTP
// Range requests so the player can seek without re-downloading.
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ key: string[] }> }
) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { key: keyParts } = await context.params;
        const key = (keyParts || []).join('/');
        if (!key) {
            return NextResponse.json({ error: 'Missing key' }, { status: 400 });
        }

        const { env } = await getCloudflareContext();
        if (!env || !env.R2) {
            return NextResponse.json({ error: 'R2 storage not configured' }, { status: 500 });
        }

        // Honour Range request so video seeking works.
        const rangeHeader = request.headers.get('range');
        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                const start = parseInt(match[1], 10);
                const endStr = match[2];
                // R2 needs `length` when end is specified; omit for open-ended ranges.
                const length = endStr ? parseInt(endStr, 10) - start + 1 : undefined;

                const obj = await env.R2.get(key, {
                    range: length !== undefined ? { offset: start, length } : { offset: start },
                });
                if (!obj) {
                    return NextResponse.json({ error: 'Not found' }, { status: 404 });
                }
                const totalSize = obj.size;
                const end = endStr ? parseInt(endStr, 10) : totalSize - 1;

                return new Response(obj.body as ReadableStream, {
                    status: 206,
                    headers: {
                        'Content-Type': obj.httpMetadata?.contentType || 'video/mp4',
                        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                        'Content-Length': String(end - start + 1),
                        'Accept-Ranges': 'bytes',
                        'Cache-Control': 'private, max-age=3600',
                    },
                });
            }
        }

        // No range: send the whole object (browsers will usually re-request with a Range after metadata).
        const obj = await env.R2.get(key);
        if (!obj) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return new Response(obj.body as ReadableStream, {
            headers: {
                'Content-Type': obj.httpMetadata?.contentType || 'video/mp4',
                'Content-Length': String(obj.size),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'private, max-age=3600',
            },
        });
    } catch (error: any) {
        console.error('Stream blog video failed:', error);
        return NextResponse.json({ error: error.message || 'Stream failed' }, { status: 500 });
    }
}
