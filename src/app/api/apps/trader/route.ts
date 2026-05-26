import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

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

// AWS SigV4 presigned GET for R2 (S3-compatible). Region is "auto" for R2;
// payload hash is UNSIGNED-PAYLOAD per the presign convention.
async function presignR2GetUrl(opts: {
    accountId: string;
    bucket: string;
    key: string;
    accessKeyId: string;
    secretAccessKey: string;
    expiresIn: number;
    filename: string;
}): Promise<string> {
    const { accountId, bucket, key, accessKeyId, secretAccessKey, expiresIn, filename } = opts;
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const region = 'auto';
    const service = 's3';

    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    const encodedKey = key.split('/').map(uriEncode).join('/');
    const canonicalUri = `/${uriEncode(bucket)}/${encodedKey}`;

    const contentDisposition = `attachment; filename="${filename}"`;
    const queryPairs: Array<[string, string]> = [
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
        ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
        ['X-Amz-Date', amzDate],
        ['X-Amz-Expires', String(expiresIn)],
        ['X-Amz-SignedHeaders', 'host'],
        ['response-content-disposition', contentDisposition],
    ];
    queryPairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const canonicalQuery = queryPairs
        .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
        .join('&');

    const canonicalRequest = [
        'GET',
        canonicalUri,
        canonicalQuery,
        `host:${host}\n`,
        'host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        await sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = await hmac(textBytes(`AWS4${secretAccessKey}`), dateStamp);
    const kRegion = await hmac(kDate, region);
    const kService = await hmac(kRegion, service);
    const kSigning = await hmac(kService, 'aws4_request');
    const signature = toHex(await hmac(kSigning, stringToSign));

    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// RFC 3986 unreserved set only — `encodeURIComponent` already covers most;
// the extras (`!'()*`) are reserved by AWS SigV4 even though JS leaves them alone.
function uriEncode(s: string): string {
    return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
        '%' + c.charCodeAt(0).toString(16).toUpperCase()
    );
}

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', textBytes(s));
    return toHex(buf);
}

async function hmac(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    return crypto.subtle.sign('HMAC', cryptoKey, textBytes(data));
}

// TextEncoder yields Uint8Array<ArrayBufferLike>, which TS rejects against the
// strict BufferSource overloads of SubtleCrypto. Copy into a fresh ArrayBuffer.
function textBytes(s: string): ArrayBuffer {
    const view = new TextEncoder().encode(s);
    const out = new ArrayBuffer(view.byteLength);
    new Uint8Array(out).set(view);
    return out;
}

function toHex(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
        s += bytes[i].toString(16).padStart(2, '0');
    }
    return s;
}
