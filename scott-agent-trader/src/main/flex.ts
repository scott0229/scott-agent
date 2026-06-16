import crypto from 'crypto'

// IB Flex Web Service — pulls historical trade records via a saved Flex Query.
//
// The token + queryId are stored in D1 (so they sync across devices). The token
// is a read-only credential, so we AES-256-GCM encrypt it before it leaves the
// app. NOTE: the key is derived from an app constant, so this keeps the token
// from being PLAINTEXT in the shared settings DB — it is NOT strong against
// someone who already has the app binary. Encryption/decryption happen only in
// the main process; the renderer only ever holds the ciphertext.

const BASE =
  'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService'

const KEY = crypto.createHash('sha256').update('scott-agent-trader::flex::v1').digest() // 32B

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

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

function decryptToken(enc: string): string {
  const buf = Buffer.from(enc, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function tagText(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? m[1].trim() : null
}

// Flex <Trade> elements are flat, self-closing, attribute-only — safe to parse
// with a focused regex (no XML dependency needed).
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

// tokenEnc is the AES blob from D1; queryId is the Flex Query ID.
export async function fetchFlexTrades(tokenEnc: string, queryId: string): Promise<FlexTrade[]> {
  if (!tokenEnc) throw new Error('尚未設定 Flex Token')
  if (!queryId) throw new Error('尚未設定 Query ID')
  let token: string
  try {
    token = decryptToken(tokenEnc)
  } catch {
    throw new Error('Token 解密失敗,請重新設定')
  }

  // 1. SendRequest → reference code.
  const sendUrl = `${BASE}.SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`
  const sendXml = await (await fetch(sendUrl)).text()
  if (tagText(sendXml, 'Status') !== 'Success') {
    const err = tagText(sendXml, 'ErrorMessage') || tagText(sendXml, 'ErrorCode') || sendXml.slice(0, 200)
    throw new Error(`Flex 請求失敗: ${err}`)
  }
  const ref = tagText(sendXml, 'ReferenceCode')
  const url = tagText(sendXml, 'Url') || `${BASE}.GetStatement`
  if (!ref) throw new Error('Flex 未回傳 ReferenceCode')

  // 2. GetStatement — IB generates the statement on demand; a big multi-account
  // query can take a minute+. Poll up to ~2 min while it's still generating
  // (Status=Warn / code 1019). Subsequent fetches are cached and fast.
  for (let i = 0; i < 30; i++) {
    await sleep(i === 0 ? 2000 : 4000)
    const getUrl = `${url}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(ref)}&v=3`
    const xml = await (await fetch(getUrl)).text()
    // Success: the real report (FlexQueryResponse / FlexStatements present).
    if (xml.includes('FlexQueryResponse') || xml.includes('<FlexStatements')) {
      return parseTrades(xml)
    }
    const status = tagText(xml, 'Status')
    if (status === 'Warn' || tagText(xml, 'ErrorCode') === '1019') continue // still generating
    if (status === 'Fail') throw new Error(`Flex 取得失敗: ${tagText(xml, 'ErrorMessage') || ''}`)
    // Unknown response — keep polling a bit rather than failing hard.
  }
  throw new Error('Flex 報表產生逾時(IB 端報表還在產生),請稍候再按重新整理')
}
