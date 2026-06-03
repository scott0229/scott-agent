import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { presignR2GetUrl } from '@/lib/r2-presign';

export const dynamic = 'force-dynamic';

// Hand the desktop trader installer to vetted users.
// Earlier attempts streamed the 97MB body through the Worker; every variant
// (200 full, 206 first-chunk, chunked w/o Content-Length) tripped Cloudflare
// resource limits or Chrome's download manager. This route now verifies the
// admin/manager token, then 302-redirects to a short-lived S3-presigned URL
// pointing directly at R2 — the browser downloads from R2's edge, the Worker
// stays out of the data path.
const R2_ACCOUNT_ID = '9946dede036802fcd2a0b9cef8e13574';
const R2_BUCKET = 'scott-agent-production';
const R2_KEY = 'apps/scott-agent-trader-setup.zip';
const FILENAME = 'scott-agent-trader-setup.zip';
const URL_TTL_SECONDS = 300;

export async function GET(request: NextRequest) {
    try {
        const user = await verifyToken(request.cookies.get('token')?.value || '');
        if (!user || !['admin', 'manager'].includes(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { env } = await getCloudflareContext();
        const accessKeyId = (env as unknown as { R2_ACCESS_KEY_ID?: string }).R2_ACCESS_KEY_ID;
        const secretAccessKey = (env as unknown as { R2_SECRET_ACCESS_KEY?: string }).R2_SECRET_ACCESS_KEY;
        if (!accessKeyId || !secretAccessKey) {
            return NextResponse.json({ error: 'R2 credentials not configured' }, { status: 500 });
        }

        const url = await presignR2GetUrl({
            accountId: R2_ACCOUNT_ID,
            bucket: R2_BUCKET,
            key: R2_KEY,
            accessKeyId,
            secretAccessKey,
            expiresIn: URL_TTL_SECONDS,
            filename: FILENAME,
        });

        return NextResponse.redirect(url, 302);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Sign failed';
        console.error('Sign trader URL failed:', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
