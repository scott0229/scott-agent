// Server-side IB Flex sync (runs in the Cloudflare cron). Reads flex_config
// from TRADER_SETTINGS (queryId + AES-encrypted token), decrypts with the SAME
// app key the desktop app uses, pulls the Flex statement, and writes the parsed
// trades back to TRADER_SETTINGS (flex_trades) — so the app just reads D1 and
// never has to fetch IB itself. Gated to once per (UTC) day.

const BASE =
  'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService'

// Cap stored rows so the D1 settings blob stays bounded.
const MAX_ROWS = 1500

export interface FlexTrade {
  account: string
  symbol: string
  underlying: string
  assetCategory: string
  tradeDate: string
  dateTime: string
  buySell: string
  quantity: number
  price: number
  proceeds: number
  commission: number
  realizedPnl: number
  expiry: string
  strike: string
  putCall: string
  tradeID: string
}

// Mirror of the desktop app's AES-256-GCM scheme: key = SHA-256(app constant),
// blob = base64(iv[12] | tag[16] | ciphertext). WebCrypto wants ct||tag.
async function decryptToken(enc: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('scott-agent-trader::flex::v1')
  )
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const blob = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0))
  const iv = blob.slice(0, 12)
  const tag = blob.slice(12, 28)
  const ct = blob.slice(28)
  const data = new Uint8Array(ct.length + tag.length)
  data.set(ct)
  data.set(tag, ct.length)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(pt)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function tagText(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? m[1].trim() : null
}

function parseTrades(xml: string): FlexTrade[] {
  const out: FlexTrade[] = []
  const tradeRe = /<Trade\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = tradeRe.exec(xml)) !== null) {
    const attrs: Record<string, string> = {}
    const attrRe = /(\w+)="([^"]*)"/g
    let a: RegExpExecArray | null
    while ((a = attrRe.exec(m[1])) !== null) attrs[a[1]] = a[2]
    if (!attrs.tradeID && !attrs.symbol) continue
    out.push({
      account: attrs.accountId || '',
      symbol: attrs.symbol || '',
      underlying: attrs.underlyingSymbol || '',
      assetCategory: attrs.assetCategory || '',
      tradeDate: attrs.tradeDate || '',
      dateTime: attrs.dateTime || '',
      buySell: attrs.buySell || '',
      quantity: parseFloat(attrs.quantity || '0'),
      price: parseFloat(attrs.tradePrice || '0'),
      proceeds: parseFloat(attrs.proceeds || '0'),
      commission: parseFloat(attrs.ibCommission || '0'),
      realizedPnl: parseFloat(attrs.fifoPnlRealized || '0'),
      expiry: attrs.expiry || '',
      strike: attrs.strike || '',
      putCall: attrs.putCall || '',
      tradeID: attrs.tradeID || ''
    })
  }
  return out
}

async function fetchFlexTrades(token: string, queryId: string): Promise<FlexTrade[]> {
  const sendUrl = `${BASE}.SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`
  const sendXml = await (await fetch(sendUrl)).text()
  if (tagText(sendXml, 'Status') !== 'Success') {
    throw new Error(
      `Flex SendRequest: ${tagText(sendXml, 'ErrorMessage') || tagText(sendXml, 'ErrorCode') || 'failed'}`
    )
  }
  const ref = tagText(sendXml, 'ReferenceCode')
  const url = tagText(sendXml, 'Url') || `${BASE}.GetStatement`
  if (!ref) throw new Error('Flex: no ReferenceCode')

  for (let i = 0; i < 30; i++) {
    await sleep(i === 0 ? 2000 : 4000)
    const getUrl = `${url}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(ref)}&v=3`
    const xml = await (await fetch(getUrl)).text()
    if (xml.includes('FlexQueryResponse') || xml.includes('<FlexStatements')) return parseTrades(xml)
    const status = tagText(xml, 'Status')
    if (status === 'Warn' || tagText(xml, 'ErrorCode') === '1019') continue
    if (status === 'Fail') throw new Error(`Flex GetStatement: ${tagText(xml, 'ErrorMessage') || ''}`)
  }
  throw new Error('Flex generation timed out')
}

async function putSetting(db: any, key: string, value: unknown): Promise<void> {
  await db
    .prepare(
      'INSERT INTO TRADER_SETTINGS (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()'
    )
    .bind(key, JSON.stringify(value))
    .run()
}

export interface FlexSyncResult {
  status: 'synced' | 'skipped'
  reason?: string
  count?: number
}

// db: a D1Database. force bypasses the once-per-day gate.
export async function syncFlexTrades(db: any, force = false): Promise<FlexSyncResult> {
  const { results } = await db
    .prepare('SELECT key, value FROM TRADER_SETTINGS WHERE key IN (?, ?)')
    .bind('flex_config', 'flex_synced_at')
    .all()
  let config: { queryId?: string; tokenEnc?: string } | undefined
  let syncedAt: string | undefined
  for (const r of (results || []) as { key: string; value: string }[]) {
    try {
      if (r.key === 'flex_config') config = JSON.parse(r.value)
      else if (r.key === 'flex_synced_at') syncedAt = JSON.parse(r.value)
    } catch {
      /* ignore */
    }
  }
  if (!config?.queryId || !config?.tokenEnc) return { status: 'skipped', reason: 'no-config' }

  const today = new Date().toISOString().slice(0, 10) // UTC day
  if (!force && syncedAt === today) return { status: 'skipped', reason: 'already-today' }

  const token = await decryptToken(config.tokenEnc)
  let rows = await fetchFlexTrades(token, config.queryId)
  rows.sort((a, b) => (b.dateTime || b.tradeDate).localeCompare(a.dateTime || a.tradeDate))
  if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS)

  await putSetting(db, 'flex_trades', { date: today, rows })
  await putSetting(db, 'flex_synced_at', today)
  return { status: 'synced', count: rows.length }
}
