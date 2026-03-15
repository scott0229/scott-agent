import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getGroupFromRequest } from '@/lib/group'

// GET /api/market-data/needed-symbols
// Returns distinct symbols that the web app needs stock price data for:
//   1. All STOCK_TRADES with status = 'Open' (for current market price display)
//   2. Hardcoded benchmark symbols: QQQ, QLD

async function checkApiKey(req: NextRequest): Promise<boolean> {
  const { searchParams } = new URL(req.url)
  const qKey = searchParams.get('apiKey')
  const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '')
  const key = qKey || headerKey
  if (!key) return false
  const db = await getDb()
  const row = await db.prepare('SELECT id FROM USERS WHERE api_key = ? LIMIT 1').bind(key).first()
  return !!row
}

export async function GET(req: NextRequest) {
  try {
    const authorized = await checkApiKey(req)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const group = await getGroupFromRequest(req)
    const db = await getDb(group)

    // Get distinct symbols from open stock trades (current year only)
    const { results } = await db.prepare(
      `SELECT DISTINCT symbol FROM STOCK_TRADES WHERE status = 'Open' AND strftime('%Y', open_date, 'unixepoch') = strftime('%Y', 'now')`
    ).all()

    const dbSymbols = (results as any[]).map(r => r.symbol as string)

    // Merge with hardcoded benchmark symbols
    const needed = new Set<string>([...dbSymbols, 'QQQ', 'QLD'])

    return NextResponse.json({ symbols: [...needed].sort() })
  } catch (error) {
    console.error('needed-symbols error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
