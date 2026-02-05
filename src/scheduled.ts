/**
 * Cloudflare Workers Scheduled Event Handler
 * This file handles cron triggers defined in wrangler.toml
 */

export default {
    async scheduled(event: any, env: any, ctx: any) {
        console.log('[Cloudflare Cron] Triggered at:', new Date().toISOString());

        try {
            // Call the auto-update API endpoint
            const url = `https://staging.scott-agent.com/api/scheduled/auto-update`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            const result = await response.json();
            console.log('[Cloudflare Cron] Auto-update result:', result);

            return result;
        } catch (error) {
            console.error('[Cloudflare Cron] Error calling auto-update:', error);
            throw error;
        }
    },
};
