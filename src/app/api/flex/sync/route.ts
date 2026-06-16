import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { syncFlexTrades } from '@/lib/flex-sync';

export const dynamic = 'force-dynamic';

// Pull IB Flex historical trades into D1 (flex_trades). Called by the cron
// (worker-entry.mjs) once per cycle — gated to once/day inside syncFlexTrades.
// The IB statement can take a minute+ to generate, so the work runs in the
// background via ctx.waitUntil and the route returns immediately.
// ?force=1 bypasses the daily gate; ?await=1 waits for the result (manual use).
export async function GET(req: NextRequest) {
    try {
        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        const params = new URL(req.url).searchParams;
        const force = params.get('force') === '1';
        const wait = params.get('await') === '1';

        if (wait) {
            const result = await syncFlexTrades(db, force);
            return NextResponse.json({ ...result, group });
        }

        const { ctx } = await getCloudflareContext();
        ctx.waitUntil(
            syncFlexTrades(db, force)
                .then((r) => console.log('[Flex] sync', group, JSON.stringify(r)))
                .catch((e) => console.warn('[Flex] sync failed', group, e))
        );
        return NextResponse.json({ started: true, group });
    } catch (error) {
        console.error('[Flex] sync route error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    return GET(req);
}
