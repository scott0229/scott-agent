// AI Trading Advisor – Main Process
// Collects current holdings + historical data from staging, builds a prompt, calls Claude API

import { getOptionQuotes, type OptionQuoteRequest } from '../ib/quotes'
import { requestOptionChain } from '../ib/options'
import { requestExecutions } from '../ib/orders'

const STAGING_BASE_URL = 'https://scott-agent.com'
const STAGING_API_KEY = 'R1TIoxXSri38FVn63eolduORz-NXUNyqoptyIx07'

interface PositionInfo {
  symbol: string
  secType: string
  quantity: number
  avgCost: number
  expiry?: string
  strike?: number
  right?: string
}

interface AccountInfo {
  accountId: string
  alias: string
  netLiquidation: number
  totalCashValue: number
  grossPositionValue: number
}

export interface AdvisorRequest {
  account: AccountInfo
  positions: PositionInfo[]
  optionQuotes: Record<string, number>
  quotes: Record<string, number>
}

export interface Recommendation {
  position: string
  action: 'roll' | 'hold' | 'close'
  targetExpiry?: string
  targetStrike?: number
  estimatedCredit?: string
  reason: string
}

export interface AdvisorResponse {
  recommendations: Recommendation[]
  summary: string
  error?: string
}

// Fetch historical data from staging
async function fetchHistoricalData(alias: string): Promise<{
  options: any[]
  stockTrades: any[]
  netEquity: any[]
  user: any
} | null> {
  try {
    // Extract just the user_id part from alias (e.g. 'profit.967 (SZU HSIEN LEE)' -> 'profit.967')
    const userId = alias.split(/[\s(]/)[0]
    console.log('[AI Advisor] Fetching historical data for userId:', userId, '(from alias:', alias, ')')
    const url = `${STAGING_BASE_URL}/api/trader-options?alias=${encodeURIComponent(userId)}&apiKey=${STAGING_API_KEY}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error('[AI Advisor] Staging API error:', res.status, await res.text())
      return null
    }
    return await res.json()
  } catch (err) {
    console.error('[AI Advisor] Failed to fetch historical data:', err)
    return null
  }
}

// Build the analysis prompt
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Convert AI expiry like "Feb24" or "Mar7" to IB format "20260224" */
function parseTargetExpiry(expiryStr: string): string | null {
  const match = expiryStr.match(/^([A-Za-z]+)(\d{1,2})$/)
  if (!match) return null
  const monthName = match[1]
  const day = parseInt(match[2], 10)
  const monthIdx = MONTHS.findIndex(m => m.toLowerCase() === monthName.toLowerCase())
  if (monthIdx < 0 || day < 1 || day > 31) return null
  const now = new Date()
  let year = now.getFullYear()
  // If the month is earlier than current month, assume next year
  if (monthIdx < now.getMonth()) year++
  return `${year}${String(monthIdx + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`
}

function buildPrompt(
  account: AccountInfo,
  positions: PositionInfo[],
  optionQuotes: Record<string, number>,
  quotes: Record<string, number>,
  historical: { options: any[]; stockTrades: any[]; netEquity: any[]; user: any },
  availableExpiries: Record<string, string[]>,
  stocksWithCC: Set<string>,
  monthlyOnlySymbols: Set<string>
): string {
  // Format current option positions
  const optionPositions = positions.filter(p => p.secType === 'OPT')
  const stockPositions = positions.filter(p => p.secType !== 'OPT')

  const formatExpiry = (exp: string): string => {
    if (!exp || exp.length < 8) return exp
    const mm = parseInt(exp.slice(4, 6), 10) - 1
    const dd = exp.slice(6, 8).replace(/^0/, '')
    return `${MONTHS[mm]}${dd}`
  }

  const today = new Date()
  const calcDTE = (exp: string): number => {
    if (!exp || exp.length < 8) return -1
    const d = new Date(`${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}T00:00:00`)
    return Math.max(0, Math.ceil((d.getTime() - today.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)))
  }

  // Current holdings section
  let currentHoldings = '## 當前持倉\n\n'

  if (stockPositions.length > 0) {
    currentHoldings += '### 股票持倉\n'
    for (const p of stockPositions) {
      const lastPrice = quotes[p.symbol]
      const pnl = lastPrice ? ((lastPrice - p.avgCost) * p.quantity) : 0
      const ccNote = stocksWithCC.has(p.symbol) ? ' (已有CC)' : ''
      const monthlyNote = monthlyOnlySymbols.has(p.symbol) ? ' (僅月期權)' : ''
      currentHoldings += `- ${p.symbol}: ${p.quantity.toLocaleString()}股, 均價=${p.avgCost.toFixed(2)}, 現價=${lastPrice?.toFixed(2) || '未知'}, 損益=${pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}${ccNote}${monthlyNote}\n`
    }
    currentHoldings += '\n'
  }

  if (optionPositions.length > 0) {
    currentHoldings += '### 期權持倉\n'
    for (const p of optionPositions) {
      const dte = calcDTE(p.expiry || '')
      const right = p.right === 'C' || p.right === 'CALL' ? 'C' : 'P'
      const label = `${p.symbol} ${formatExpiry(p.expiry || '')} ${p.strike}${right}`
      const key = `${p.symbol}|${p.expiry}|${p.strike}|${p.right}`
      const lastPrice = optionQuotes[key]
      const avgUnit = p.avgCost / 100
      const pnl = lastPrice ? ((lastPrice - avgUnit) * p.quantity * 100) : 0
      const direction = p.quantity > 0 ? 'Long(買入)' : 'Short(賣出)'
      currentHoldings += `- ${label}: ${direction} ${Math.abs(p.quantity)}張, DTE=${dte}, 均價=${avgUnit.toFixed(2)}, 現價=${lastPrice?.toFixed(2) || '未知'}, 損益=${pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n`
    }
    currentHoldings += '\n'
  }

  // Account summary
  const accountSection = `## 帳戶概況
- 帳戶: ${account.alias} (${account.accountId})
- 淨值: ${account.netLiquidation.toLocaleString()}
- 現金: ${account.totalCashValue.toLocaleString()}
- 持倉市值: ${account.grossPositionValue.toLocaleString()}
- 融資率: ${account.netLiquidation > 0 ? (account.grossPositionValue / account.netLiquidation).toFixed(2) : 'N/A'}
`

  // Available expiry dates per underlying
  let expirySection = ''
  const expiryKeys = Object.keys(availableExpiries)
  if (expiryKeys.length > 0) {
    expirySection = '## 各標的可用到期日（非常重要！只能使用以下日期）\n'
    for (const sym of expiryKeys) {
      const dates = availableExpiries[sym]
      // Format dates: 20260224 -> Feb24, 20260227 -> Feb27
      const formatted = dates.map(d => {
        const m = MONTHS[parseInt(d.substring(4, 6), 10) - 1]
        const day = parseInt(d.substring(6, 8), 10)
        return `${m}${day}`
      })
      expirySection += `- ${sym}: ${formatted.join(', ')}\n`
    }
    expirySection += '\n'
  }

  // Historical trading patterns
  let histSection = '## 歷史交易資料\n\n'

  // Add default trading frequency if no historical data
  if (!historical.options || historical.options.length === 0) {
    histSection += `### 預設交易習慣（重要）\n`
    histSection += `- 此用戶的 Covered Call (CC) 和 Cash-Secured Put (CSP) 策略是持續賣出權利金\n`
    histSection += `- 展期原則：一律展期到該標的「最近的下一個可用到期日」\n`
    histSection += `- 不同標的有不同的期權週期：有些有每日到期（如QQQ、SPY），有些只有每週五到期（如TQQQ、SQQQ等ETF）\n`
    histSection += `- 請根據「各標的可用到期日」列表來判斷每個標的的實際週期，不要一律假設1-2天\n\n`
  }

  // Option trade history
  if (historical.options && historical.options.length > 0) {
    histSection += '### 近期期權交易（最近20筆）\n'
    const recent = historical.options.slice(0, 20)
    for (const o of recent) {
      const openDate = o.open_date ? new Date(o.open_date * 1000).toLocaleDateString('zh-TW') : '?'
      const toDate = o.to_date ? new Date(o.to_date * 1000).toLocaleDateString('zh-TW') : '?'
      const right = o.type === 'CALL' ? 'C' : o.type === 'PUT' ? 'P' : o.type
      histSection += `- [${o.status}] ${o.underlying} ${o.strike_price}${right} | ${o.operation || '新開倉'} | ${openDate}→${toDate} | ${o.quantity}張 | 權利金=${o.premium || 0} | 損益=${o.final_profit || '未結'} | delta=${o.delta || '?'}\n`
    }
    histSection += '\n'

    // Extract trading patterns
    console.log('[AI Advisor] Historical options count:', historical.options.length)
    if (historical.options.length > 0) {
      console.log('[AI Advisor] Sample option record:', JSON.stringify(historical.options[0]))
    }
    // Use to_date presence to identify completed trades (status string varies)
    const closedOptions = historical.options.filter((o: any) => o.to_date && o.open_date)
    console.log('[AI Advisor] Closed options (with to_date) count:', closedOptions.length)
    if (closedOptions.length > 0) {
      const winRate = closedOptions.filter((o: any) => (o.final_profit || 0) > 0).length / closedOptions.length
      const rollCount = closedOptions.filter((o: any) => o.operation === '滾動').length

      histSection += `### 期權交易模式分析\n`
      histSection += `- 已結算筆數: ${closedOptions.length}\n`
      histSection += `- 勝率: ${(winRate * 100).toFixed(1)}%\n`
      histSection += `- 展期次數: ${rollCount} (${closedOptions.length > 0 ? ((rollCount / closedOptions.length) * 100).toFixed(0) : 0}%)\n\n`

      // Per-underlying + type stats
      const groupMap: Record<string, { count: number; totalDays: number; totalPremium: number; deltas: number[] }> = {}
      for (const o of closedOptions) {
        const right = o.type === 'CALL' ? 'CALL' : o.type === 'PUT' ? 'PUT' : o.type
        const key = `${o.underlying} ${right}`
        if (!groupMap[key]) groupMap[key] = { count: 0, totalDays: 0, totalPremium: 0, deltas: [] }
        groupMap[key].count++
        if (o.open_date && o.to_date) {
          groupMap[key].totalDays += Math.max(1, Math.round((o.to_date - o.open_date) / 86400))
        }
        groupMap[key].totalPremium += (o.premium || 0)
        if (o.delta) groupMap[key].deltas.push(Math.abs(o.delta))
      }

      histSection += `### 各標的交易習慣（非常重要，展期天數請參考此數據）\n`
      for (const [key, g] of Object.entries(groupMap)) {
        const avgDays = g.count > 0 ? (g.totalDays / g.count).toFixed(1) : '?'
        const avgPrem = g.count > 0 ? (g.totalPremium / g.count).toFixed(2) : '?'
        const avgDelta = g.deltas.length > 0 ? (g.deltas.reduce((a, b) => a + b, 0) / g.deltas.length).toFixed(3) : '?'
        histSection += `- ${key}: ${g.count}筆, 平均持有${avgDays}天, 平均權利金=${avgPrem}, 平均delta=${avgDelta}\n`
      }
      histSection += '\n'

      // Debug log
      console.log('[AI Advisor] Per-underlying patterns:', groupMap)
    }
  }

  // Stock trade history
  if (historical.stockTrades && historical.stockTrades.length > 0) {
    histSection += '### 近期股票交易（最近10筆）\n'
    const recent = historical.stockTrades.slice(0, 10)
    for (const s of recent) {
      const openDate = s.open_date ? new Date(s.open_date * 1000).toLocaleDateString('zh-TW') : '?'
      const closeDate = s.close_date ? new Date(s.close_date * 1000).toLocaleDateString('zh-TW') : '持有中'
      histSection += `- [${s.status}] ${s.symbol} | ${s.quantity}股 | ${openDate}→${closeDate} | 開=${s.open_price} 關=${s.close_price || '—'}\n`
    }
    histSection += '\n'
  }

  // Net equity trend
  if (historical.netEquity && historical.netEquity.length > 0) {
    histSection += '### 帳戶淨值趨勢（最近10天）\n'
    const recent = historical.netEquity.slice(0, 10).reverse()
    for (const ne of recent) {
      const date = ne.date ? new Date(ne.date * 1000).toLocaleDateString('zh-TW') : '?'
      histSection += `- ${date}: 淨值=${ne.net_equity?.toLocaleString() || '?'}, 現金=${ne.cash_balance?.toLocaleString() || '?'}\n`
    }
    histSection += '\n'
  }

  const systemPrompt = `你是一位專業的期權交易顧問，專門分析美股期權交易策略。
用戶是台灣的投資顧問，管理多個 IB (Interactive Brokers) 帳戶。
他們主要做 Covered Call (CC) 和 Cash-Secured Put (CSP) 策略來收取權利金。

請基於以下資料，為每個期權持倉提供具體建議：
1. 是否需要展期（Roll）、持有（Hold）、或平倉（Close）
2. 如果建議展期，建議移到哪個到期日和行權價
3. 預估的收益或成本
4. 詳細的理由

重要規則：
- Short 持倉 = 賣出期權（CC/CSP），到期時通常展期繼續收租
- Long 持倉 = 買入期權，簡短建議持有或平倉即可，不需要展期
- 「展期」(Roll) = 平倉現有 + 開新倉，用 action="roll" 並填 targetExpiry 和 targetStrike
- Short 持倉到期（DTE=0 或 DTE=1）幾乎都應建議展期，即使 OTM 快歸零也要 roll 繼續收租
- reason 要簡潔扼要，不要解釋策略定義，直接給出判斷和依據
- reason 中不要使用 DTE=X 這種英文縮寫，改用中文「到期日剩X天」
- 只有在以下特殊情況才使用 action="close"：用戶明顯想退出該標的、或該標的有重大風險不適合繼續做 CC/CSP
- DTE=0 或 DTE=1 的期權非常緊急，優先分析，建議展期到合適的到期日和行權價
- 展期建議必須填寫具體的 targetExpiry（如 "Mar7"）和 targetStrike（如 610）
- 非常重要：展期天數必須遵守嚴格的規則：
  * 你必須從「各標的可用到期日」中選擇一個實際存在的到期日。不同標的有不同的到期日週期（有些是每日到期，有些是每週五到期），絕對不能建議不存在的到期日
  * 在可用日期中，選擇最近的下一個到期日。對於每日到期的標的（如QQQ），這通常是明天；對於每週到期的標的（如TQQQ），這通常是下一個週五
  * 行權價選擇：優先使用相同行權價。如果當前期權是深度OTM（價外超過2%），可以把行權價往ATM方向移動一檔（例如614→613或615），但不要跳太多檔
  * 此規則不可違反，優先級高於歷史交易習慣數據
- 考慮帳戶的融資率和現金狀況
- 所有金額以美金計算
- 如果帳戶只有股票沒有期權，可以建議賣出新的 CC/CSP，使用 action="sell" 並填入 targetExpiry 和 targetStrike
- 非常重要：如果股票持倉標示了「(已有CC)」，代表該股票已經有賣出的 Covered Call，絕對不要再建議賣出新的 CC。已有 CC 的股票不需要出現在建議中（除非有其他非CC相關的建議）
- 非常重要：如果股票持倉標示了「(僅月期權)」，代表該標的只有月期權（沒有每日或每週期權），不適合短期賣出 CC/CSP 策略，絕對不要建議賣出期權。這類標的不需要出現在建議中
- 非常重要：賣出 Covered Call 的行權價必須高於該股票的持有成本（均價）。如果現價低於均價，表示目前是虧損狀態，賣出行權價低於均價的 CC 會在被行權時鎖定虧損。此時該股票不需要出現在建議中，不要建議任何動作（不要建議平倉、不要建議持有、不要建議賣出CC）
- 非常重要：股票持倉只會出現在建議 CC 賣出的情境中。絕對不要對股票持倉建議「平倉」或「賣出股票」。這個工具只負責期權相關建議，不負責股票買賣決策。如果某股票不適合賣 CC，就完全跳過它
- reason 中除了說明展期原因，也要對照「各標的交易習慣」中的歷史平均權利金來評論這次展期的預估信用品質。例如：如果 TQQQ CALL 歷史平均權利金是 $0.85，而這次展期信用是 +$0.63，就說明低於平均；如果是 +$1.20 就說明高於平均。要讓用戶知道這次收益和過去比起來如何

回答格式必須是以下 JSON（不要加 markdown code fence）：
{
  "recommendations": [
    {
      "position": "QQQ Feb23 594P",
      "action": "roll",
      "targetExpiry": "Mar7",
      "targetStrike": 590,
      "estimatedCredit": "+$0.85",
      "reason": "到期日為明天，建議展期至3月第一週..."
    },
    {
      "position": "PLTR股票",
      "action": "sell",
      "targetExpiry": "Feb27",
      "targetStrike": 135,
      "estimatedCredit": "+$2.50",
      "reason": "持有3000股，建議賣出135 Call收取權利金"
    }
  ],
  "summary": "整體建議摘要..."
}`

  return `${systemPrompt}\n\n---\n\n${accountSection}\n${expirySection}${currentHoldings}\n${histSection}`
}

// Call Claude API
async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// Read Claude API key from settings
async function getClaudeApiKey(): Promise<string | null> {
  try {
    const res = await fetch(`${STAGING_BASE_URL}/api/trader-settings`)
    const data = await res.json()
    return data.settings?.claudeApiKey || null
  } catch {
    return null
  }
}

// Main advisor function
export async function getAiAdvice(request: AdvisorRequest): Promise<AdvisorResponse> {
  const { account, positions, optionQuotes, quotes } = request

  // 1. Check Claude API key
  const claudeKey = await getClaudeApiKey()
  if (!claudeKey) {
    return {
      recommendations: [],
      summary: '',
      error: '請先在設定中填入 Claude API Key'
    }
  }

  // 2. Get alias for this account
  const alias = account.alias
  if (!alias) {
    return {
      recommendations: [],
      summary: '',
      error: '此帳戶沒有設定別名，無法匹配歷史資料'
    }
  }

  // 3. Fetch historical data from staging
  const historical = await fetchHistoricalData(alias)
  if (!historical) {
    // Still proceed with analysis, just without historical data
    console.warn('[AI Advisor] No historical data found, proceeding with current positions only')
  }

  // 4. Detect which stocks already have short calls (CC) from ORIGINAL positions
  // Must do this before filtering, because filtering removes traded options
  const stocksWithCC = new Set<string>()
  for (const p of positions) {
    if (p.secType === 'OPT') {
      const right = p.right === 'C' || p.right === 'CALL' ? 'C' : 'P'
      if (right === 'C' && p.quantity < 0) {
        stocksWithCC.add(p.symbol)
      }
    }
  }
  if (stocksWithCC.size > 0) {
    console.log(`[AI Advisor] Stocks with existing CC: ${[...stocksWithCC].join(', ')}`)
  }

  // 5. Fetch today's executions to skip already-traded positions
  let filteredPositions = positions
  try {
    const executions = await requestExecutions()
    // Filter executions for this account only
    const acctExecs = executions.filter(e => e.account === account.accountId)
    if (acctExecs.length > 0) {
      // Build a set of option keys that have been traded today (by symbol+expiry+strike+right)
      const tradedKeys = new Set<string>()
      for (const exec of acctExecs) {
        if (exec.secType === 'OPT' || exec.secType === 'BAG') {
          // For BAG (combo roll) orders, the symbol is the underlying
          // Mark ALL option positions of this underlying as already traded
          if (exec.secType === 'BAG') {
            tradedKeys.add(`BAG:${exec.symbol}`)
          } else if (exec.expiry && exec.strike) {
            const r = exec.right === 'CALL' ? 'C' : exec.right === 'PUT' ? 'P' : exec.right
            tradedKeys.add(`${exec.symbol}|${exec.expiry}|${exec.strike}|${r}`)
          }
        }
      }

      if (tradedKeys.size > 0) {
        console.log(`[AI Advisor] Today's traded option keys for ${account.accountId}:`, [...tradedKeys])
        const beforeCount = filteredPositions.filter(p => p.secType === 'OPT').length
        filteredPositions = positions.filter(p => {
          if (p.secType !== 'OPT') return true // Keep stock positions
          // Check if this specific option was traded
          const r = p.right === 'CALL' ? 'C' : p.right === 'PUT' ? 'P' : p.right
          const key = `${p.symbol}|${p.expiry}|${p.strike}|${r}`
          if (tradedKeys.has(key)) return false
          // Check if underlying was traded via BAG (combo roll)
          if (tradedKeys.has(`BAG:${p.symbol}`)) return false
          return true
        })
        const afterCount = filteredPositions.filter(p => p.secType === 'OPT').length
        console.log(`[AI Advisor] Filtered out ${beforeCount - afterCount} already-traded option positions (${beforeCount} → ${afterCount})`)
      }
    }
  } catch (err) {
    console.warn('[AI Advisor] Failed to fetch executions, proceeding without filtering:', err)
  }

  // 5. Fetch available expiry dates for each underlying with option positions
  const availableExpiries: Record<string, string[]> = {}
  const optSymbols = [...new Set(filteredPositions.filter(p => p.secType === 'OPT').map(p => p.symbol))]
  const today = new Date()
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  for (const sym of optSymbols) {
    try {
      const chains = await requestOptionChain(sym)
      if (chains.length > 0) {
        // Merge expirations from ALL chains (different trading classes have different expiry cycles)
        // e.g. QQQ has regular monthly + daily/weekly options across different trading classes
        const allExpiries = new Set<string>()
        for (const chain of chains) {
          for (const exp of chain.expirations) {
            if (exp >= todayStr) allExpiries.add(exp)
          }
        }
        const nearExpiries = [...allExpiries].sort().slice(0, 10) // Next 10 available dates
        if (nearExpiries.length > 0) {
          availableExpiries[sym] = nearExpiries
          console.log(`[AI Advisor] ${sym} available expiries (${chains.length} chains merged): ${nearExpiries.join(', ')}`)
        }
      }
    } catch (err) {
      console.warn(`[AI Advisor] Failed to fetch option chain for ${sym}:`, err)
    }
  }

  // 6. Detect monthly-only symbols (less than 3 expiry dates in next 14 days = monthly only)
  const monthlyOnlySymbols = new Set<string>()
  const stockSymbols = [...new Set(positions.filter(p => p.secType !== 'OPT').map(p => p.symbol))]
  for (const sym of stockSymbols) {
    const expiries = availableExpiries[sym]
    if (!expiries || expiries.length === 0) {
      // No expiry data available - check if we have option chain data
      // If not in availableExpiries at all, we need to fetch it
      try {
        const chains = await requestOptionChain(sym)
        if (chains.length > 0) {
          const allExpiries: string[] = []
          const now = new Date()
          const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
          const in14DaysStr = `${in14Days.getFullYear()}${String(in14Days.getMonth() + 1).padStart(2, '0')}${String(in14Days.getDate()).padStart(2, '0')}`
          for (const chain of chains) {
            for (const exp of chain.expirations) {
              if (exp >= todayStr && exp <= in14DaysStr) allExpiries.push(exp)
            }
          }
          if (allExpiries.length < 3) {
            monthlyOnlySymbols.add(sym)
          }
        }
      } catch (err) {
        console.warn(`[AI Advisor] Failed to check option chain for ${sym}:`, err)
      }
    } else {
      // Count expiries in next 14 days
      const now = new Date()
      const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
      const in14DaysStr = `${in14Days.getFullYear()}${String(in14Days.getMonth() + 1).padStart(2, '0')}${String(in14Days.getDate()).padStart(2, '0')}`
      const nearExpiries = expiries.filter(e => e >= todayStr && e <= in14DaysStr)
      if (nearExpiries.length < 3) {
        monthlyOnlySymbols.add(sym)
      }
    }
  }
  if (monthlyOnlySymbols.size > 0) {
    console.log(`[AI Advisor] Monthly-only symbols (no weekly/daily options): ${[...monthlyOnlySymbols].join(', ')}`)
  }

  // 7. Filter out monthly-only stock positions so AI cannot suggest CC/CSP for them
  if (monthlyOnlySymbols.size > 0) {
    filteredPositions = filteredPositions.filter(p => {
      if (p.secType !== 'OPT' && monthlyOnlySymbols.has(p.symbol)) {
        console.log(`[AI Advisor] Removing monthly-only stock from prompt: ${p.symbol}`)
        return false
      }
      return true
    })
  }

  // 8. Build prompt
  const prompt = buildPrompt(
    account,
    filteredPositions,
    optionQuotes,
    quotes,
    historical || { options: [], stockTrades: [], netEquity: [], user: null },
    availableExpiries,
    stocksWithCC,
    monthlyOnlySymbols
  )

  console.log('[AI Advisor] Prompt length:', prompt.length)

  // Debug: dump prompt to temp file
  try {
    const fs = require('fs')
    const path = require('path')
    const tmpFile = path.join(require('electron').app.getPath('userData'), 'ai-prompt-debug.txt')
    fs.writeFileSync(tmpFile, prompt, 'utf-8')
    console.log('[AI Advisor] Prompt dumped to:', tmpFile)
  } catch (e) {
    console.error('[AI Advisor] Failed to dump prompt:', e)
  }

  // 5. Call Claude API
  try {
    const responseText = await callClaude(prompt, claudeKey)

    // 6. Parse response
    try {
      // Try to extract JSON from the response
      let jsonStr = responseText.trim()
      // Remove markdown code fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fenceMatch) jsonStr = fenceMatch[1].trim()

      const parsed = JSON.parse(jsonStr) as AdvisorResponse
      const recs = parsed.recommendations || []

      // 7. Post-process: fetch real IB quotes for roll targets
      try {
        await enrichWithRealQuotes(recs, optionQuotes, positions)
      } catch (e) {
        console.warn('[AI Advisor] Failed to enrich with real quotes:', e)
      }

      return {
        recommendations: recs,
        summary: parsed.summary || ''
      }
    } catch {
      // If JSON parsing fails, return the raw text as summary
      return {
        recommendations: [],
        summary: responseText
      }
    }
  } catch (err) {
    console.error('[AI Advisor] Claude API call failed:', err)
    return {
      recommendations: [],
      summary: '',
      error: `AI 分析失敗: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

/**
 * After Claude returns recommendations, fetch real IB option quotes
 * for BOTH the current and target contracts and update estimatedCredit.
 * We fetch current quotes directly from IB (instead of relying on frontend
 * optionQuotes) to avoid key format mismatches (e.g. "CALL" vs "C").
 */
async function enrichWithRealQuotes(
  recs: AdvisorResponse['recommendations'],
  _currentQuotes: Record<string, number>,
  positions: PositionInfo[]
): Promise<void> {
  // Collect all contracts that need quoting (both current and target)
  const allContracts: OptionQuoteRequest[] = []
  const recInfo: {
    recIdx: number
    targetKey: string
    currentKey: string
  }[] = []

  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i]
    if (rec.action !== 'roll' || !rec.targetExpiry || !rec.targetStrike) continue

    console.log(`[AI Advisor] Processing roll rec[${i}]: position="${rec.position}" targetExpiry="${rec.targetExpiry}" targetStrike=${rec.targetStrike}`)

    // Parse the position field to extract symbol and right
    // Format: "QQQ Feb23 614C" or "PLTR Feb23 130P"
    const posMatch = rec.position.match(/^(\w+)\s+\w+\d+\s+[\d.]+([CP])$/i)
    if (!posMatch) {
      console.log(`[AI Advisor] Cannot parse position: ${rec.position}, skipping quote`)
      continue
    }
    const symbol = posMatch[1].toUpperCase()
    const right = posMatch[2].toUpperCase()

    // Convert target expiry to IB format
    const ibExpiry = parseTargetExpiry(rec.targetExpiry)
    if (!ibExpiry) {
      console.log(`[AI Advisor] Cannot parse target expiry: ${rec.targetExpiry}, skipping quote`)
      continue
    }

    // Find the matching current position
    const currentPos = positions.find(p =>
      p.symbol === symbol && p.secType === 'OPT' &&
      (p.right === right || p.right === (right === 'C' ? 'CALL' : 'PUT'))
    )

    // Build target contract
    const targetContract: OptionQuoteRequest = {
      symbol,
      expiry: ibExpiry,
      strike: rec.targetStrike,
      right
    }
    const targetKey = `${symbol}|${ibExpiry}|${rec.targetStrike}|${right}`
    allContracts.push(targetContract)

    // Build current contract (fetch from IB directly to avoid key format issues)
    let currentKey = ''
    if (currentPos && currentPos.expiry && currentPos.strike) {
      const currentContract: OptionQuoteRequest = {
        symbol: currentPos.symbol,
        expiry: currentPos.expiry,
        strike: currentPos.strike,
        right  // Use parsed 'C'/'P' to keep key format consistent
      }
      currentKey = `${currentPos.symbol}|${currentPos.expiry}|${currentPos.strike}|${right}`
      allContracts.push(currentContract)
    }

    console.log(`[AI Advisor] Parsed: symbol=${symbol} right=${right} ibExpiry=${ibExpiry} targetKey="${targetKey}" currentKey="${currentKey}"`)

    recInfo.push({ recIdx: i, targetKey, currentKey })
  }

  if (allContracts.length === 0) return

  // De-duplicate contracts so we don't fetch the same one twice
  const seen = new Set<string>()
  const uniqueContracts = allContracts.filter(c => {
    const k = `${c.symbol}|${c.expiry}|${c.strike}|${c.right}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  console.log(`[AI Advisor] Fetching ${uniqueContracts.length} quotes from IB (${allContracts.length} before dedup)`)
  const quotes = await getOptionQuotes(uniqueContracts)
  console.log('[AI Advisor] All quotes:', quotes)

  // Update each recommendation with real values
  for (const { recIdx, targetKey, currentKey } of recInfo) {
    const newPrice = quotes[targetKey] || 0
    const oldPrice = currentKey ? (quotes[currentKey] || 0) : 0

    console.log(`[AI Advisor] ${recs[recIdx].position}: oldPrice(${currentKey})=${oldPrice} newPrice(${targetKey})=${newPrice}`)

    if (newPrice > 0) {
      // For short options (covered calls / CSP), rolling means:
      // Buy back current at oldPrice, sell new at newPrice
      const netCredit = newPrice - oldPrice
      const sign = netCredit >= 0 ? '+' : ''
      recs[recIdx].estimatedCredit = `${sign}$${netCredit.toFixed(2)}`
      console.log(`[AI Advisor] Real quote: close@${oldPrice.toFixed(2)} → new@${newPrice.toFixed(2)} = ${sign}$${netCredit.toFixed(2)}`)
    } else {
      // Keep Claude's estimate but mark it
      if (recs[recIdx].estimatedCredit && !recs[recIdx].estimatedCredit.includes('估')) {
        recs[recIdx].estimatedCredit = `${recs[recIdx].estimatedCredit} (估)`
      }
      console.log(`[AI Advisor] No real quote for ${targetKey}, keeping estimate: ${recs[recIdx].estimatedCredit}`)
    }
  }
}
