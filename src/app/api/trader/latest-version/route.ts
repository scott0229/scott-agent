import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { presignR2GetUrl } from '@/lib/r2-presign';

export const dynamic = 'force-dynamic';

// The desktop trader app polls this every hour. To roll a new release:
//   1. Build the new installer locally
//   2. Upload the .zip to R2 (apps/scott-agent-trader-setup.zip)
//   3. Bump LATEST_VERSION below and redeploy this Worker
// The version comparison in the desktop app is numeric per `a.b.c` segment.
const LATEST_VERSION = '1.2.6';

const R2_ACCOUNT_ID = '9946dede036802fcd2a0b9cef8e13574';
const R2_BUCKET = 'scott-agent-production';
const R2_KEY = 'apps/scott-agent-trader-setup.zip';
const FILENAME = 'scott-agent-trader-setup.zip';
// Generous TTL so a slow downloader has time to finish before the URL expires.
const URL_TTL_SECONDS = 1800;

// Same API-key auth as trader-settings / trader-account-groups. Lets the
// desktop app authenticate without a JWT cookie.
async function checkApiKey(req: NextRequest): Promise<boolean> {
    const { searchParams } = new URL(req.url);
    const qKey = searchParams.get('apiKey');
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    const key = qKey || headerKey;
    if (!key) return false;
    const db = await getDb('advisor');
    const row = await db.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    if (row) return true;
    const dbScott = await getDb('scott');
    const row2 = await dbScott.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    return !!row2;
}

export async function GET(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req);
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { env } = await getCloudflareContext();
        const accessKeyId = (env as unknown as { R2_ACCESS_KEY_ID?: string }).R2_ACCESS_KEY_ID;
        const secretAccessKey = (env as unknown as { R2_SECRET_ACCESS_KEY?: string }).R2_SECRET_ACCESS_KEY;
        if (!accessKeyId || !secretAccessKey) {
            return NextResponse.json({ error: 'R2 credentials not configured' }, { status: 500 });
        }

        const downloadUrl = await presignR2GetUrl({
            accountId: R2_ACCOUNT_ID,
            bucket: R2_BUCKET,
            key: R2_KEY,
            accessKeyId,
            secretAccessKey,
            expiresIn: URL_TTL_SECONDS,
            filename: FILENAME,
        });

        return NextResponse.json({
            version: LATEST_VERSION,
            downloadUrl,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Lookup failed';
        console.error('GET trader/latest-version failed:', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
