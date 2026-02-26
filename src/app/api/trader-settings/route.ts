import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

export const dynamic = 'force-dynamic';

// Simple API key auth: pass ?apiKey=... or Authorization: Bearer ...
// The key is stored in USERS.api_key for admin user.
async function checkApiKey(req: NextRequest): Promise<boolean> {
    const { searchParams } = new URL(req.url);
    const qKey = searchParams.get('apiKey');
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    const key = qKey || headerKey;
    if (!key) return false;

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);
    const row = await db.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    return !!row;
}

// GET /api/trader-settings  — no auth required (non-sensitive config)
export async function GET(_req: NextRequest) {
    try {
        const group = await getGroupFromRequest(_req);
        const db = await getDb(group);
        const { results } = await db.prepare('SELECT key, value FROM TRADER_SETTINGS').all();

        const settings: Record<string, unknown> = {};
        for (const row of results as { key: string; value: string }[]) {
            try {
                settings[row.key] = JSON.parse(row.value);
            } catch {
                settings[row.key] = row.value;
            }
        }

        return NextResponse.json({ settings });
    } catch (error) {
        console.error('GET trader-settings error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

// PUT /api/trader-settings  — requires API key
export async function PUT(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req);
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { key, value } = await req.json() as { key: string; value: unknown };

        if (!key) {
            return NextResponse.json({ error: '缺少 key' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        await db.prepare(
            'INSERT INTO TRADER_SETTINGS (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()'
        ).bind(key, JSON.stringify(value)).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('PUT trader-settings error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
