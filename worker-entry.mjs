// Custom worker entrypoint wrapping the OpenNext-generated handler.
//
// Why this exists: wrangler.toml declares an every-15-minutes cron,
// but the OpenNext build output (.open-next/worker.js) only exports a
// `fetch` handler — no `scheduled`. Cloudflare fired the cron into a
// worker that had nothing listening, so /api/scheduled/auto-update
// NEVER ran on schedule; market data only refreshed when someone
// manually curled the endpoint (the 06-08 ~ 06-10 QQQ gap).
//
// The wrapper re-exports everything OpenNext produces and adds a
// `scheduled` handler that invokes the auto-update route through the
// same in-worker fetch handler (no public-edge round trip, can't be
// blocked by WAF/bot rules).
//
// wrangler.toml `main` points here; the relative import is bundled by
// wrangler at deploy time, after `build:cf` regenerates .open-next.

import handler from './.open-next/worker.js';

export { DOQueueHandler } from './.open-next/worker.js';
export { DOShardedTagCache } from './.open-next/worker.js';
export { BucketCachePurge } from './.open-next/worker.js';

export default {
    ...handler,

    async scheduled(controller, env, ctx) {
        // Host must be the real production domain: the route derives its
        // warm-up origin from req.url, and those warm-up fetches should
        // hit the public edge.
        const request = new Request('https://scott-agent.com/api/scheduled/auto-update', {
            headers: { 'x-triggered-by': 'cloudflare-cron' },
        });
        try {
            const res = await handler.fetch(request, env, ctx);
            console.log(`[Cron] auto-update responded ${res.status}`);
        } catch (err) {
            console.error('[Cron] auto-update failed:', err);
        }

        // IB Flex historical trades — pull once/day into D1 so the desktop app
        // just reads it (no need to open the app). The route gates to once/day
        // and runs the long IB poll in the background via ctx.waitUntil.
        try {
            const flexReq = new Request('https://scott-agent.com/api/flex/sync?group=advisor', {
                headers: { 'x-triggered-by': 'cloudflare-cron' },
            });
            const flexRes = await handler.fetch(flexReq, env, ctx);
            console.log(`[Cron] flex sync responded ${flexRes.status}`);
        } catch (err) {
            console.error('[Cron] flex sync failed:', err);
        }
    },
};
