import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { clearMarketDataCache } from '@/lib/market-data';
import { clearCache, clearCacheByPattern } from '@/lib/response-cache';

// API Key is now read ONLY from database (admin user's api_key field)
// No environment variable fallback - admin must configure via settings page

interface AlphaVantageResponse {
    'Meta Data': any;
    'Time Series (Daily)': {
        [date: string]: {
            '1. open': string;
            '2. high': string;
            '3. low': string;
            '4. close': string;
            '5. volume': string;
        };
    };
}

// Helper function to send SSE message
function sendSSE(controller: ReadableStreamDefaultController, data: any) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(new TextEncoder().encode(message));
}

export async function POST(request: Request) {
    let body: any;
    try {
        const text = await request.text();
        console.log('[Backfill API] Raw request body:', text.substring(0, 200));
        body = JSON.parse(text);
    } catch (error) {
        console.error('[Backfill API] JSON parse error:', error);
        return NextResponse.json({
            success: false,
            error: `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
        }, { status: 400 });
    }

    const { userId, symbol, year } = body;

    if (!userId) {
        return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
    }

    // Create a ReadableStream for SSE
    const stream = new ReadableStream({
        async start(controller) {
            try {
                const DB = await getDb();

                // Fetch admin user's API key from database
                const adminResult = await DB.prepare(
                    'SELECT api_key FROM USERS WHERE user_id = ? OR id = ?'
                ).bind('admin', 1).first();

                const apiKey = (adminResult as any)?.api_key;

                if (!apiKey) {
                    sendSSE(controller, {
                        type: 'error',
                        message: 'API Key not configured. Please set Alpha Vantage API Key in admin settings.'
                    });
                    controller.close();
                    return;
                }

                console.log(`Using admin's API key from database for market data backfill`);
                console.log(`[Market Data Update] Received parameters:`, { userId, symbol, year });

                // Determine symbols to process
                let symbols: string[];
                if (symbol) {
                    symbols = [symbol];
                } else {
                    // Build query with optional year filter
                    let query = 'SELECT DISTINCT symbol FROM STOCK_TRADES';
                    const params: any[] = [];

                    if (year) {
                        query += ' WHERE year = ?';
                        params.push(year);
                    }

                    query += ' ORDER BY symbol';

                    const stmt = DB.prepare(query);
                    const { results: holdingSymbols } = params.length > 0
                        ? await stmt.bind(...params).all()
                        : await stmt.all();

                    symbols = (holdingSymbols as any[]).map((row: any) => row.symbol);

                    // Always ensure QQQ and QLD are included as core benchmarks
                    const coreBenchmarks = ['QQQ', 'QLD'];
                    for (const benchmark of coreBenchmarks) {
                        if (!symbols.includes(benchmark)) {
                            symbols.push(benchmark);
                        }
                    }

                    if (symbols.length === 0) {
                        symbols = ['QQQ', 'QLD'];
                        console.log('No stock trades found, using default symbols:', symbols);
                    } else {
                        const yearInfo = year ? ` for year ${year}` : '';
                        console.log(`Fetched stock symbols from database${yearInfo}:`, symbols);
                    }
                }

                // Send initial event with symbol list
                sendSSE(controller, {
                    type: 'init',
                    symbols: symbols,
                    totalSymbols: symbols.length
                });

                let totalInserted = 0;
                const errors: string[] = [];
                const symbolResults: { symbol: string; status: 'success' | 'failed' | 'skipped'; recordsInserted: number; error?: string }[] = [];

                // Helper functions
                const isTradingDay = (date: Date): boolean => {
                    const day = date.getDay();
                    return day !== 0 && day !== 6;
                };

                const getTradingDaysBetween = (startDate: Date, endDate: Date): Date[] => {
                    const days: Date[] = [];
                    const current = new Date(startDate);
                    while (current <= endDate) {
                        if (isTradingDay(current)) {
                            days.push(new Date(current));
                        }
                        current.setDate(current.getDate() + 1);
                    }
                    return days;
                };

                // Process each symbol
                for (const sym of symbols) {
                    try {
                        console.log(`\n=== Processing ${sym} ===`);

                        // Send processing event
                        sendSSE(controller, {
                            type: 'progress',
                            symbol: sym,
                            status: 'processing'
                        });

                        // Check for existing data
                        const { results: latestResults } = await DB.prepare(
                            `SELECT MAX(date) as latest_date, COUNT(*) as record_count FROM market_prices WHERE symbol = ?`
                        ).bind(sym).all();

                        const hasData = latestResults && latestResults.length > 0 && (latestResults[0] as any).record_count > 0;
                        const latestTimestamp = hasData ? (latestResults[0] as any).latest_date : null;

                        let datesToFill: Date[] = [];
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        if (hasData && latestTimestamp) {
                            const latestDate = new Date(latestTimestamp * 1000);
                            latestDate.setDate(latestDate.getDate() + 1);
                            datesToFill = getTradingDaysBetween(latestDate, today);
                            console.log(`${sym}: Found existing data up to ${new Date(latestTimestamp * 1000).toISOString().split('T')[0]}, will check for ${datesToFill.length} potential missing days`);
                            console.log(`${sym}: Forcing API call to ensure latest data`);
                        } else {
                            console.log(`${sym}: No existing data, will fetch all available data`);
                        }

                        // Fetch from Alpha Vantage
                        const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${sym}&outputsize=compact&apikey=${apiKey}`;
                        console.log(`${sym}: Fetching from Alpha Vantage...`);
                        const response = await fetch(url);

                        if (!response.ok) {
                            const errorMsg = `HTTP ${response.status}`;
                            console.error(`${sym}: Failed to fetch - ${errorMsg}`);
                            errors.push(`${sym}: ${errorMsg}`);
                            symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });

                            sendSSE(controller, {
                                type: 'progress',
                                symbol: sym,
                                status: 'failed',
                                error: errorMsg,
                                recordsInserted: 0
                            });
                            continue;
                        }

                        const data: AlphaVantageResponse = await response.json();
                        console.log(`${sym}: API response received`, JSON.stringify(data).substring(0, 200));

                        if (data['Meta Data'] === undefined) {
                            const errorMsg = `Invalid API response: ${JSON.stringify(data).substring(0, 200)}`;
                            console.error(`${sym}: ${errorMsg}`);
                            errors.push(`${sym}: ${errorMsg}`);
                            symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });

                            sendSSE(controller, {
                                type: 'progress',
                                symbol: sym,
                                status: 'failed',
                                error: errorMsg,
                                recordsInserted: 0
                            });
                            continue;
                        }

                        const timeSeries = data['Time Series (Daily)'];
                        if (!timeSeries) {
                            const errorMsg = 'No time series data in response';
                            console.error(`${sym}: ${errorMsg}`);
                            errors.push(`${sym}: ${errorMsg}`);
                            symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });

                            sendSSE(controller, {
                                type: 'progress',
                                symbol: sym,
                                status: 'failed',
                                error: errorMsg,
                                recordsInserted: 0
                            });
                            continue;
                        }

                        // Prepare batch insert
                        // Always insert/update all data from API to ensure latest prices
                        const insertStmt = DB.prepare(
                            `INSERT INTO market_prices (symbol, date, close_price) 
                             VALUES (?, ?, ?) 
                             ON CONFLICT(symbol, date) DO UPDATE SET close_price=excluded.close_price`
                        );

                        const batch: any[] = [];

                        // Process all dates from the API response
                        for (const [dateStr, values] of Object.entries(timeSeries)) {
                            const closePrice = parseFloat(values['4. close']);
                            const [year, month, day] = dateStr.split('-').map(Number);
                            const timestamp = Date.UTC(year, month - 1, day) / 1000;
                            batch.push(insertStmt.bind(sym, timestamp, closePrice));
                        }

                        console.log(`${sym}: Prepared ${batch.length} records for insertion`);

                        if (batch.length > 0) {
                            await DB.batch(batch);
                            totalInserted += batch.length;
                            console.log(`${sym}: ✅ Successfully inserted ${batch.length} records`);
                            symbolResults.push({ symbol: sym, status: 'success', recordsInserted: batch.length });

                            clearMarketDataCache(sym);
                            clearCacheByPattern(`benchmark-.*-${sym}-.*`);

                            sendSSE(controller, {
                                type: 'progress',
                                symbol: sym,
                                status: 'success',
                                recordsInserted: batch.length
                            });
                        } else {
                            console.log(`${sym}: No new records to insert`);
                            symbolResults.push({ symbol: sym, status: 'success', recordsInserted: 0 });

                            sendSSE(controller, {
                                type: 'progress',
                                symbol: sym,
                                status: 'success',
                                recordsInserted: 0
                            });
                        }

                        // Add delay between API calls (1 second)
                        if (symbols.indexOf(sym) < symbols.length - 1) {
                            console.log(`Waiting 1 second before next API call...`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }

                    } catch (error: any) {
                        const errorMsg = error.message || 'Unknown error';
                        console.error(`${sym}: ❌ Error - ${errorMsg}`, error);
                        errors.push(`${sym}: ${errorMsg}`);
                        symbolResults.push({ symbol: sym, status: 'failed', recordsInserted: 0, error: errorMsg });

                        sendSSE(controller, {
                            type: 'progress',
                            symbol: sym,
                            status: 'failed',
                            error: errorMsg,
                            recordsInserted: 0
                        });
                    }
                }

                // Clear all response caches (including net-equity-bulk) so charts reflect updated market data
                clearCache();

                // Generate summary message
                const successCount = symbolResults.filter(r => r.status === 'success').length;
                const failedCount = symbolResults.filter(r => r.status === 'failed').length;

                let message = `完成處理 ${symbols.length} 個標的`;
                if (successCount > 0) message += ` | ✓ 成功: ${successCount}`;
                if (failedCount > 0) message += ` | ✗ 失敗: ${failedCount}`;
                message += ` | 共新增 ${totalInserted} 筆資料`;

                const details: string[] = [];
                for (const result of symbolResults) {
                    if (result.status === 'success') {
                        details.push(`✓ ${result.symbol}: 新增 ${result.recordsInserted} 筆`);
                    } else if (result.status === 'failed') {
                        details.push(`✗ ${result.symbol}: ${result.error || '失敗'}`);
                    }
                }

                if (details.length > 0) {
                    message += '\n\n' + details.join('\n');
                }

                // Send completion event
                sendSSE(controller, {
                    type: 'complete',
                    success: failedCount === 0,
                    totalInserted,
                    symbols,
                    symbolResults,
                    errors: errors.length > 0 ? errors : undefined,
                    message
                });

                controller.close();

            } catch (error: any) {
                console.error('Backfill API Error:', error);
                sendSSE(controller, {
                    type: 'error',
                    message: error.message || 'Internal Server Error'
                });
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
