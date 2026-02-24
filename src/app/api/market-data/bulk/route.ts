import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// POST /api/market-data/bulk
// Body: { rows: Array<{ symbol: string, date: number, price: number }> }
// Requires API key via ?apiKey= or Authorization: Bearer ...

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

export async function POST(req: NextRequest) {
  try {
    const authorized = await checkApiKey(req)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { rows } = (await req.json()) as {
      rows: { symbol: string; date: number; price: number }[]
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    }

    const db = await getDb()

    // Batch upsert in chunks of 100
    const CHUNK = 100
    let inserted = 0

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const stmts = chunk.map((r) =>
        db
          .prepare(
            `INSERT INTO market_prices (symbol, date, close_price)
             VALUES (?, ?, ?)
             ON CONFLICT(symbol, date) DO UPDATE SET close_price = excluded.close_price`
          )
          .bind(r.symbol, r.date, r.price)
      )
      await db.batch(stmts)
      inserted += chunk.length
    }

    return NextResponse.json({ success: true, inserted })
  } catch (error) {
    console.error('Bulk market-data upload error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
