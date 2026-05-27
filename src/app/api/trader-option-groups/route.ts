import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Reuse the same API key auth pattern as trader-account-types.
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

// Convert OPTIONS.type ("CALL"/"PUT") to IB single-letter ("C"/"P").
function rightChar(type: string | null): 'C' | 'P' | null {
    if (!type) return null;
    const t = type.toUpperCase().trim();
    if (t === 'C' || t === 'CALL') return 'C';
    if (t === 'P' || t === 'PUT') return 'P';
    return null;
}

// Convert unix timestamp (seconds) to YYYYMMDD UTC string (matches IB expiry format).
function tsToYmd(ts: number | null): string | null {
    if (!ts) return null;
    const d = new Date(ts * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

// GET /api/trader-option-groups?accounts=U123,U456
// Returns a map of currently OPEN option contracts → group_id, so the desktop
// trader app can label each IB position with the website's group tag.
//
// Key format: `${ib_account}|${expiry_yyyymmdd}|${strike}|${right_char}`
export async function GET(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req);
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const accountsParam = searchParams.get('accounts');

        if (!accountsParam) {
            return NextResponse.json({ error: 'Missing accounts parameter' }, { status: 400 });
        }

        const accountIds = accountsParam.split(',').map(a => a.trim()).filter(Boolean);
        if (accountIds.length === 0) {
            return NextResponse.json({ error: 'No valid accounts provided' }, { status: 400 });
        }

        const currentYear = new Date().getFullYear();

        const groups: { dbName: string }[] = [
            { dbName: 'advisor' },
            { dbName: 'scott' },
        ];

        const optionGroups: Record<string, string> = {};

        for (const g of groups) {
            const db = await getDb(g.dbName);
            const placeholders = accountIds.map(() => '?').join(',');
            // Join OPTIONS to USERS via owner_id to map back to ib_account.
            // Filter to currently open trades; the same contract closed in an
            // earlier trade wouldn't match a live IB position anyway.
            const query = `
                SELECT u.ib_account,
                       o.underlying,
                       o.to_date,
                       o.strike_price,
                       o.type,
                       o.group_id
                  FROM OPTIONS o
                  JOIN USERS u ON o.owner_id = u.id
                 WHERE u.ib_account IN (${placeholders})
                   AND u.year = ?
                   AND o.year = ?
                   AND o.status = 'Open'
                   AND o.group_id IS NOT NULL
            `;
            const rows = await db.prepare(query).bind(...accountIds, currentYear, currentYear).all() as {
                results: {
                    ib_account: string;
                    underlying: string;
                    to_date: number | null;
                    strike_price: number;
                    type: string | null;
                    group_id: string | number | null;
                }[]
            };
            for (const row of (rows.results || [])) {
                const ymd = tsToYmd(row.to_date);
                const r = rightChar(row.type);
                if (!ymd || !r) continue;
                const key = `${row.ib_account}|${ymd}|${row.strike_price}|${r}`;
                if (!optionGroups[key] && row.group_id != null) {
                    optionGroups[key] = String(row.group_id);
                }
            }
        }

        return NextResponse.json({ optionGroups });
    } catch (error) {
        console.error('GET trader-option-groups error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
