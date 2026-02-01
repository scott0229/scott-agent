import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function GET(request: Request) {
    const startTime = Date.now();

    try {
        // Get user from token
        const token = request.headers.get('cookie')?.split('token=')[1]?.split(';')[0];
        if (!token) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const payload = await verifyToken(token);
        if (!payload) {
            return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
        }

        const DB = await getDb();

        // Fetch admin user's API key from database (admin user has id = 1 or user_id = 'admin')
        const adminResult = await DB.prepare(
            'SELECT api_key FROM USERS WHERE user_id = ? OR id = ?'
        ).bind('admin', 1).first();

        // Use admin's API key if available, otherwise fall back to environment variable
        const ALPHA_VANTAGE_API_KEY = (adminResult as any)?.api_key || process.env.ALPHA_VANTAGE_API_KEY || 'BJ9X47DS0OLOPYM0';
        console.log(`Using admin's API key for Alpha Vantage test`);


        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get('symbol') || 'QQQ';

        const testResults: any = {
            timestamp: new Date().toISOString(),
            environment: 'Cloudflare Workers (Staging/Production)',
            symbol,
            apiKey: `${ALPHA_VANTAGE_API_KEY.substring(0, 4)}...${ALPHA_VANTAGE_API_KEY.substring(ALPHA_VANTAGE_API_KEY.length - 4)}`,
        };

        // Build Alpha Vantage URL
        const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`;

        console.log(`[Alpha Vantage Test] Fetching data for ${symbol}...`);
        console.log(`[Alpha Vantage Test] URL: ${url.replace(ALPHA_VANTAGE_API_KEY, 'API_KEY_HIDDEN')}`);

        // Make the request
        const response = await fetch(url);
        const fetchDuration = Date.now() - startTime;

        testResults.fetchDurationMs = fetchDuration;
        testResults.httpStatus = response.status;
        testResults.httpStatusText = response.statusText;

        // Get response headers
        testResults.headers = Object.fromEntries(response.headers.entries());

        // Parse JSON response
        const data = await response.json();

        // Check for different response scenarios
        if (data['Note']) {
            testResults.status = '⚠️ RATE_LIMITED';
            testResults.message = 'Alpha Vantage rate limit exceeded';
            testResults.note = data['Note'];
        } else if (data['Information']) {
            testResults.status = '⚠️ PREMIUM_REQUIRED';
            testResults.message = 'Attempted to use premium feature with free API key';
            testResults.information = data['Information'];
        } else if (data['Error Message']) {
            testResults.status = '❌ ERROR';
            testResults.message = 'Alpha Vantage returned an error';
            testResults.error = data['Error Message'];
        } else if (data['Meta Data']) {
            testResults.status = '✅ SUCCESS';
            testResults.message = 'Successfully fetched data from Alpha Vantage';
            testResults.metaData = data['Meta Data'];

            // Count time series entries
            const timeSeries = data['Time Series (Daily)'];
            if (timeSeries) {
                const entries = Object.keys(timeSeries);
                testResults.recordCount = entries.length;
                testResults.dateRange = {
                    earliest: entries[entries.length - 1],
                    latest: entries[0],
                };

                // Show first entry as sample
                testResults.sampleData = {
                    date: entries[0],
                    data: timeSeries[entries[0]]
                };
            }
        } else {
            testResults.status = '❓ UNKNOWN';
            testResults.message = 'Unexpected response format';
        }

        // Include full response for debugging (truncated if too large)
        const responseStr = JSON.stringify(data);
        testResults.fullResponseLength = responseStr.length;
        testResults.fullResponse = responseStr.length > 2000
            ? responseStr.substring(0, 2000) + '... (truncated)'
            : data;

        console.log(`[Alpha Vantage Test] Result:`, testResults.status);

        return NextResponse.json({
            success: true,
            testResults,
        });

    } catch (error: any) {
        const fetchDuration = Date.now() - startTime;

        console.error('[Alpha Vantage Test] Error:', error);

        return NextResponse.json({
            success: false,
            testResults: {
                timestamp: new Date().toISOString(),
                fetchDurationMs: fetchDuration,
                status: '❌ EXCEPTION',
                message: 'Failed to fetch from Alpha Vantage',
                error: error.message,
                errorStack: error.stack,
            }
        }, { status: 500 });
    }
}
