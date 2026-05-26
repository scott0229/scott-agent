import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

// Stream the desktop trader installer (zipped .exe) out of R2.
// Gated to authenticated admin/manager users; matches /api/blog-video pattern.
// Served as .zip because Chrome Safe Browsing flags unsigned .exe downloads
// as "uncommon and possibly dangerous" — the same bytes inside a zip avoid
// that warning until/unless we get a code-signing cert.
const R2_KEY = 'apps/scott-agent-trader-setup.zip';
const FILENAME = 'scott-agent-trader-setup.zip';
const CONTENT_TYPE = 'application/zip';

export async function GET(request: NextRequest) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { env } = await getCloudflareContext();
        if (!env || !env.R2) {
            return NextResponse.json({ error: 'R2 storage not configured' }, { status: 500 });
        }

        const rangeHeader = request.headers.get('range');
        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                const start = parseInt(match[1], 10);
                const endStr = match[2];
                const length = endStr ? parseInt(endStr, 10) - start + 1 : undefined;

                const obj = await env.R2.get(R2_KEY, {
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
                        'Content-Type': CONTENT_TYPE,
                        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                        'Content-Length': String(end - start + 1),
                        'Accept-Ranges': 'bytes',
                        'Content-Disposition': `attachment; filename="${FILENAME}"`,
                        'Cache-Control': 'private, max-age=0, must-revalidate',
                    },
                });
            }
        }

        // Full-file path: instead of streaming the whole 97MB through the
        // worker (which trips Error 1102 — exceeded resource limits — on
        // the OpenNext adapter), respond with a 206 first-chunk so the
        // browser switches into Range mode and downloads the rest in
        // bounded pieces. Each subsequent request hits the Range branch
        // above with a manageable size.
        const obj = await env.R2.head(R2_KEY);
        if (!obj) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const totalSize = obj.size;
        const CHUNK = 8 * 1024 * 1024; // 8MB first chunk
        const end = Math.min(CHUNK - 1, totalSize - 1);
        const firstChunk = await env.R2.get(R2_KEY, { range: { offset: 0, length: end + 1 } });
        if (!firstChunk) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        return new Response(firstChunk.body as ReadableStream, {
            status: 206,
            headers: {
                'Content-Type': CONTENT_TYPE,
                'Content-Range': `bytes 0-${end}/${totalSize}`,
                'Content-Length': String(end + 1),
                'Accept-Ranges': 'bytes',
                'Content-Disposition': `attachment; filename="${FILENAME}"`,
                'Cache-Control': 'private, max-age=0, must-revalidate',
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Stream failed';
        console.error('Stream trader exe failed:', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
