import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { clearMarketDataCache } from '@/lib/market-data'
import { clearCache } from '@/lib/response-cache'

// POST /api/market-data/clear-cache
// Body: { symbols?: string[] }  (omit to clear all)
// Requires Authorization: Bearer <api_key>

async function checkApiKey(req: NextRequest): Promise<boolean> {
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '')
    const { searchParams } = new URL(req.url)
    const key = headerKey || searchParams.get('apiKey')
    if (!key) return false
    const db = await getDb()
    const row = await db.prepare('SELECT id FROM USERS WHERE api_key = ? LIMIT 1').bind(key).first()
    return !!row
}

export async function POST(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req)
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const symbols: string[] | undefined = body.symbols

        if (symbols && symbols.length > 0) {
            for (const sym of symbols) {
                clearMarketDataCache(sym)
            }
        } else {
            clearMarketDataCache()
        }

        // Clear all response caches (net-equity, benchmark charts, etc.)
        clearCache()

        console.log('[clear-cache] Market data cache cleared', symbols ?? 'all')
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[clear-cache] Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
