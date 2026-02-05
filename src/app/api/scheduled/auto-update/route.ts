import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Scheduled task endpoint to auto-update market data
 * This endpoint is triggered by Cloudflare Cron or can be called manually
 */
export async function GET(req: NextRequest) {
    try {
        console.log('[Auto Update] Starting scheduled market data update...');

        const db = await getDb();

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
                            await db.prepare(
                                `INSERT OR REPLACE INTO market_prices (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`
                            ).bind(
                                symbol,
                                timestamp,
                                parseFloat(dayData['1. open']),
                                parseFloat(dayData['2. high']),
                                parseFloat(dayData['3. low']),
                                parseFloat(dayData['4. close']),
                                parseInt(dayData['5. volume'])
                            ).run();

                            inserted++;
                        }

                        console.log(`[Auto Update] Successfully inserted/updated ${inserted} records for ${symbol}`);

                        await db.prepare(
                            `UPDATE USERS SET last_auto_update_status = 'success', last_auto_update_message = ? WHERE id = ?`
                        ).bind(`成功更新 ${symbol}（${inserted} 筆記錄）`, user.id).run();

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

        const response = {
            success: true,
            currentTime,
            message: `Checked ${users.length} users, updated ${updatedUsers.length} users`,
            updatedUsers,
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
