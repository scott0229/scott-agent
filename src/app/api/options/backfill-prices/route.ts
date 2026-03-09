import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';

// API key check (same pattern as market-data/bulk)
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

// GET: Return OPTIONS records missing underlying_price for a given symbol
export async function GET(req: NextRequest) {
  try {
    const authorized = await checkApiKey(req)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const symbol = searchParams.get('symbol')

    const group = await getGroupFromRequest(req)
    const db = await getDb(group)

    // No symbol → return distinct underlyings with missing prices
    if (!symbol) {
      const { results } = await db.prepare(
        `SELECT DISTINCT underlying FROM OPTIONS
         WHERE underlying IS NOT NULL AND (underlying_price IS NULL OR underlying_price = 0)
         ORDER BY underlying`
      ).all()
      const symbols = results.map((r: Record<string, unknown>) => r.underlying as string)
      return NextResponse.json({ symbols })
    }

    const { results } = await db.prepare(
      `SELECT id, open_date FROM OPTIONS
       WHERE underlying = ? AND (underlying_price IS NULL OR underlying_price = 0)
       ORDER BY open_date DESC`
    ).bind(symbol.toUpperCase()).all()

    return NextResponse.json({ options: results })
  } catch (error) {
    console.error('Backfill-prices GET error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST: Batch-update underlying_price for given option IDs
export async function POST(req: NextRequest) {
  try {
    const authorized = await checkApiKey(req)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { updates } = (await req.json()) as {
      updates: { id: number; underlying_price: number }[]
    }

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const group = await getGroupFromRequest(req)
    const db = await getDb(group)

    // Batch update in chunks of 50
    const CHUNK = 50
    let updated = 0

    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK)
      const stmts = chunk.map((u) =>
        db.prepare(
          `UPDATE OPTIONS SET underlying_price = ?, updated_at = unixepoch() WHERE id = ?`
        ).bind(u.underlying_price, u.id)
      )
      await db.batch(stmts)
      updated += chunk.length
    }

    return NextResponse.json({ success: true, updated })
  } catch (error) {
    console.error('Backfill-prices POST error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
