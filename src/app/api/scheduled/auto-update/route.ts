import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { getIntradayPricesForMinutes } from '@/lib/intraday-prices';

export const dynamic = 'force-dynamic';

/**
 * Scheduled task endpoint to auto-update market data
 * This endpoint is triggered by Cloudflare Cron or can be called manually
 */
export async function GET(req: NextRequest) {
    try {
        console.log('[Auto Update] Starting scheduled market data update...');

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Get current time in HH:MM format (Hong Kong Time, UTC+8)
        const now = new Date();
        const utcHours = now.getUTCHours();
        const utcMinutes = now.getUTCMinutes();

        // Convert to HKT (UTC+8)
        const hktHours = (utcHours + 8) % 24;
        const hktMinutes = utcMinutes; // Minutes don't change with timezone
        const currentTime = `${hktHours.toString().padStart(2, '0')}:${hktMinutes.toString().padStart(2, '0')}`;

        console.log(`[Auto Update] Current HKT time: ${currentTime}`);

        // Find users whose auto_update_time matches current time (within 15-minute window)
        // Since cron runs every 15 minutes, we need to check if current time is within the scheduled time
        const currentHour = hktHours;
        const currentMinute = hktMinutes;

        // Query all users with auto_update_time set
        const { results: users } = await db.prepare(
            `SELECT id, user_id, email, auto_update_time, role FROM USERS WHERE auto_update_time IS NOT NULL`
        ).all();

        console.log(`[Auto Update] Found ${users.length} users with auto_update_time set`);

        const updatedUsers: string[] = [];

        for (const user of users as any[]) {
            const [targetHour, targetMinute] = user.auto_update_time.split(':').map(Number);

            // Check if we should update for this user
            // Calculate the total minutes since midnight for easier comparison
            const currentTotalMinutes = currentHour * 60 + currentMinute;
            const targetTotalMinutes = targetHour * 60 + targetMinute;

            // Update if current time is within the same 15-minute window as the target time
            // Cron runs at 00, 15, 30, 45 minutes past each hour
            // We want to trigger if the target time falls within the current 15-minute window
            const cronWindowStart = Math.floor(currentMinute / 15) * 15;
            const cronWindowEnd = cronWindowStart + 15;

            const shouldUpdate =
                currentHour === targetHour &&
                targetMinute >= cronWindowStart &&
                targetMinute < cronWindowEnd;

            if (shouldUpdate) {
                console.log(`[Auto Update] Triggering update for user: ${user.user_id || user.email} at ${user.auto_update_time}`);

                try {
                    // Mark update as running
                    await db.prepare(
                        `UPDATE USERS SET last_auto_update_time = ?, last_auto_update_status = 'running', last_auto_update_message = '正在更新市場資料...' WHERE id = ?`
                    ).bind(Math.floor(Date.now() / 1000), user.id).run();

                    try {
                        // Get admin API key
                        const { results: adminUsers } = await db.prepare(
                            `SELECT api_key FROM USERS WHERE role = 'admin' LIMIT 1`
                        ).all();

                        const apiKey = (adminUsers[0] as any)?.api_key;

                        if (!apiKey) {
                            await db.prepare(
                                `UPDATE USERS SET last_auto_update_status = 'failed', last_auto_update_message = '未找到 API 金鑰' WHERE id = ?`
                            ).bind(user.id).run();
                            continue;
                        }

                        // Directly fetch QQQ price from Alpha Vantage (simplified, no backfill API)
                        const symbol = 'QQQ';
                        const avUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${apiKey}`;

                        console.log(`[Auto Update] Fetching ${symbol} from Alpha Vantage for ${user.user_id || user.email}`);

                        const avResponse = await fetch(avUrl, {
                            signal: AbortSignal.timeout(20000) // 20 second timeout
                        });

                        if (!avResponse.ok) {
                            throw new Error(`Alpha Vantage API returned ${avResponse.status}`);
                        }

                        const avData: any = await avResponse.json();

                        if (!avData['Meta Data'] || !avData['Time Series (Daily)']) {
                            throw new Error(`Invalid API response: ${JSON.stringify(avData).substring(0, 100)}`);
                        }

                        // Insert latest prices into database
                        const timeSeries = avData['Time Series (Daily)'];
                        const dates = Object.keys(timeSeries).sort().reverse().slice(0, 10); // Last 10 days

                        let inserted = 0;
                        for (const dateStr of dates) {
                            const timestamp = Math.floor(new Date(dateStr).getTime() / 1000);
                            const dayData = timeSeries[dateStr];

                            // Upsert (insert or replace)
                            const closePrice = parseFloat(dayData['4. close']);
                            await db.prepare(
                                `INSERT OR REPLACE INTO market_prices (symbol, date, close_price, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                            ).bind(
                                symbol,
                                timestamp,
                                closePrice,  // close_price (legacy NOT NULL column)
                                parseFloat(dayData['1. open']),
                                parseFloat(dayData['2. high']),
                                parseFloat(dayData['3. low']),
                                closePrice,  // close (new column, same value)
                                parseInt(dayData['5. volume'])
                            ).run();

                            inserted++;
                        }

                        console.log(`[Auto Update] Successfully inserted/updated ${inserted} records for ${symbol}`);

                        await db.prepare(
                            `UPDATE USERS SET last_auto_update_status = 'success', last_auto_update_message = ? WHERE id = ?`
                        ).bind(`成功更新 ${symbol}`, user.id).run();

                        updatedUsers.push(user.user_id || user.email);

                    } catch (fetchError) {
                        const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
                        console.error(`[Auto Update] Error fetching market data for ${user.user_id || user.email}:`, errorMsg);

                        await db.prepare(
                            `UPDATE USERS SET last_auto_update_status = 'failed', last_auto_update_message = ? WHERE id = ?`
                        ).bind(`更新失敗: ${errorMsg.substring(0, 100)}`, user.id).run();
                    }
                } catch (error) {
                    console.error(`[Auto Update] Error updating market data for ${user.user_id || user.email}:`, error);

                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await db.prepare(
                        `UPDATE USERS SET last_auto_update_status = 'failed', last_auto_update_message = ? WHERE id = ?`
                    ).bind(`錯誤: ${errorMessage.substring(0, 100)}`, user.id).run();
                }
            }
        }

        // Unconditional QQQ OHLC refresh via Yahoo Finance. The per-user
        // Alpha Vantage block above only runs for users whose
        // auto_update_time falls in the current 15-min window — and even
        // then the free-tier 25/day cap silently 503s after the quota's
        // gone. Yahoo's chart endpoint has no key, no day cap, and returns
        // full OHLC, so we hit it once per tick to keep market_prices
        // current. range=5d covers any same-week gap; small payload, one
        // HTTP call.
        try {
            const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/QQQ?range=5d&interval=1d`;
            const yRes = await fetch(yUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
                    'Accept': 'application/json',
                },
                signal: AbortSignal.timeout(10000),
            });
            if (yRes.ok) {
                const yData = await yRes.json() as {
                    chart?: { result?: {
                        timestamp?: number[];
                        indicators?: { quote?: {
                            open?: (number | null)[]; high?: (number | null)[];
                            low?: (number | null)[]; close?: (number | null)[];
                            volume?: (number | null)[];
                        }[]; };
                    }[]; };
                };
                const result = yData.chart?.result?.[0];
                const timestamps = result?.timestamp;
                const quote = result?.indicators?.quote?.[0];
                if (timestamps && quote) {
                    const stmt = db.prepare(`
                        INSERT INTO market_prices (symbol, date, close_price, open, high, low, close, volume)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(symbol, date) DO UPDATE SET
                            close_price=excluded.close_price,
                            open=excluded.open, high=excluded.high,
                            low=excluded.low, close=excluded.close,
                            volume=excluded.volume
                    `);
                    const batch: ReturnType<typeof stmt.bind>[] = [];
                    for (let i = 0; i < timestamps.length; i++) {
                        const ts = timestamps[i];
                        const close = quote.close?.[i];
                        const open = quote.open?.[i];
                        if (close == null || open == null) continue;
                        const d = new Date(ts * 1000);
                        const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
                        batch.push(stmt.bind(
                            'QQQ', midnight, close, open,
                            quote.high?.[i] ?? null, quote.low?.[i] ?? null,
                            close, quote.volume?.[i] ?? null,
                        ));
                    }
                    if (batch.length > 0) {
                        await db.batch(batch);
                        console.log(`[Auto Update] Yahoo QQQ OHLC upserted ${batch.length} rows`);
                    }
                }
            } else {
                console.warn(`[Auto Update] Yahoo QQQ fetch returned ${yRes.status}`);
            }
        } catch (err) {
            console.warn('[Auto Update] Yahoo QQQ refresh failed (non-fatal):', err);
        }

        // Backfill underlying spot for any option-trade minute in the last
        // 7 calendar days that's still missing from market_prices_minute.
        // 7 days keeps us inside Yahoo's 1m precision window — once cached
        // the row survives indefinitely even after Yahoo forgets the bar.
        //
        // Why here: the per-page /api/daily-trades path is lazy and only
        // resolves minutes a user actively viewed. If nobody opens the
        // page for a date within ~7 days we'd silently lose 1m precision.
        // The cron runs regardless of user activity, so it's the right
        // place to guarantee coverage.
        //
        // Cost shape: getIntradayPricesForMinutes hits Yahoo at most once
        // per (symbol, day) and only when there's at least one missing
        // minute. Steady-state (after the first warm-up) most ticks see
        // zero missing minutes and skip Yahoo entirely. Total upper
        // bound per tick is ~7 Yahoo calls; in practice it's 0–1.
        try {
            const todayHkt = new Date(Date.now() + 8 * 3600 * 1000);
            const backfillDates: string[] = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(todayHkt);
                d.setUTCDate(d.getUTCDate() - i);
                const y = d.getUTCFullYear();
                const m = String(d.getUTCMonth() + 1).padStart(2, '0');
                const day = String(d.getUTCDate()).padStart(2, '0');
                backfillDates.push(`${y}-${m}-${day}`);
            }

            let totalCached = 0;
            for (const dateStr of backfillDates) {
                // Pull every option open_date that lands on this date for
                // any user. The HH:MM string is what /api/daily-trades
                // formats, computed off the stored "ET wall-clock as UTC".
                const { results: tradeMinutes } = await db.prepare(`
                    SELECT DISTINCT
                        strftime('%H:%M', datetime(open_date, 'unixepoch')) AS hhmm
                    FROM OPTIONS
                    WHERE underlying = 'QQQ'
                      AND open_date IS NOT NULL
                      AND date(datetime(open_date, 'unixepoch')) = ?
                `).bind(dateStr).all<{ hhmm: string }>();

                const required = new Set((tradeMinutes || []).map(r => r.hhmm));
                if (required.size === 0) continue;

                const resolved = await getIntradayPricesForMinutes(db, 'QQQ', dateStr, required);
                totalCached += Object.keys(resolved).length;
            }
            if (totalCached > 0) {
                console.log(`[Auto Update] Intraday backfill resolved ${totalCached} (symbol, minute) prices across last 7d`);
            }
        } catch (err) {
            console.warn('[Auto Update] Intraday backfill failed (non-fatal):', err);
        }

        // Warm up the worker. Cold-start CPU + render CPU occasionally
        // overflows the per-request budget and surfaces as Cloudflare
        // Error 1102 ("Worker exceeded resource limits"). Firing N parallel
        // GETs to /login from inside the cron handler keeps the OpenNext
        // SSR path hot — and because each fetch goes through the public
        // edge, Cloudflare may land them on different isolates, warming
        // more than one region per tick. Cache-bust with the timestamp so
        // we hit the SSR path every time, not a cached HTML response.
        const warmupOrigin = new URL(req.url).origin;
        const warmupTs = Date.now();
        const warmupResults = await Promise.allSettled(
            Array.from({ length: 6 }, (_, i) =>
                fetch(`${warmupOrigin}/login?warmup=${warmupTs}-${i}`, {
                    signal: AbortSignal.timeout(8000),
                    headers: { 'Cache-Control': 'no-cache' },
                })
            )
        );
        const warmupOk = warmupResults.filter(r => r.status === 'fulfilled' && r.value.ok).length;
        console.log(`[Auto Update] Worker warm-up: ${warmupOk}/${warmupResults.length} OK`);

        const response = {
            success: true,
            currentTime,
            message: `Checked ${users.length} users, updated ${updatedUsers.length} users`,
            updatedUsers,
            warmup: { sent: warmupResults.length, ok: warmupOk },
            timestamp: now.toISOString()
        };

        console.log('[Auto Update] Completed:', response);

        return NextResponse.json(response);

    } catch (error) {
        console.error('[Auto Update] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            },
            { status: 500 }
        );
    }
}

/**
 * Allow manual trigger via POST
 */
export async function POST(req: NextRequest) {
    return GET(req);
}
