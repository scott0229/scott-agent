// AWS SigV4 presigned GET for R2 (S3-compatible). Region is "auto" for R2;
// payload hash is UNSIGNED-PAYLOAD per the presign convention.
//
// Pure Web Crypto — works in the Cloudflare Workers runtime. Shared between
// /api/apps/trader (admin downloads) and /api/trader/latest-version (auto-
// update from the desktop app).

export async function presignR2GetUrl(opts: {
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
