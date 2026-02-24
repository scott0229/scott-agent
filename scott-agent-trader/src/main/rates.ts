/**
 * rates.ts – Fetch Fed Funds Rate (DFF) from FRED API.
 * Cached for 24 hours; falls back to last known value on error.
 */

const FRED_API_KEY = 'aded63456fa78e80b7d339ec1e02fd2e'
const FRED_URL = `https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${FRED_API_KEY}&sort_order=desc&limit=1&file_type=json`

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

let cachedRate: number | null = null
let cacheTs = 0

export async function getFedFundsRate(): Promise<number> {
  const now = Date.now()
  if (cachedRate !== null && now - cacheTs < CACHE_TTL_MS) {
    return cachedRate
  }

  try {
    const res = await fetch(FRED_URL)
    const json = (await res.json()) as { observations?: { value: string }[] }
    const raw = json.observations?.[0]?.value
    if (raw && raw !== '.') {
      cachedRate = parseFloat(raw)
      cacheTs = now
      console.log(`[rates] Fed Funds Rate updated: ${cachedRate}%`)
      return cachedRate
    }
  } catch (e) {
    console.warn('[rates] Failed to fetch Fed Funds Rate from FRED:', e)
  }

  // Fallback: return last cached value or hardcoded default
  return cachedRate ?? 4.33
}

/**
 * IB margin interest rate tiers (USD, above benchmark).
 * Returns the all-in annualised rate for a given loan amount in USD.
 */
export function ibMarginRate(loanUsd: number, benchmarkRate: number): number {
  let spread: number
  const abs = Math.abs(loanUsd)
  if (abs <= 100_000) {
    spread = 1.5
  } else if (abs <= 1_000_000) {
    spread = 1.0
  } else if (abs <= 3_000_000) {
    spread = 0.5
  } else {
    spread = 0.25
  }
  return benchmarkRate + spread
}

/**
 * Estimated daily interest for a negative cash balance (USD).
 * loanUsd should be a negative number (e.g. -50000).
 */
export function estimateDailyInterest(loanUsd: number, benchmarkRate: number): number {
  if (loanUsd >= 0) return 0
  const annualRate = ibMarginRate(loanUsd, benchmarkRate) / 100
  return (Math.abs(loanUsd) * annualRate) / 360
}
