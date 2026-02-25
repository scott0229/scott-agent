/**
 * Background option chain preloader for QQQ and TQQQ.
 *
 * On IB connection, pre-fetches chain params + Greeks for the nearest
 * expirations & strikes around the current stock price, then refreshes
 * every 30 seconds.  Frontend dialogs hit the cache and open instantly.
 */
import { requestOptionChain, requestOptionGreeks } from './options'
import { getStockQuote } from './quotes'

const PRELOAD_SYMBOLS = ['QQQ', 'TQQQ']
const REFRESH_INTERVAL_MS = 30_000
const NUM_EXPIRATIONS = 3
const STRIKES_RADIUS = 40 // ±40 strikes around current price

let refreshTimer: ReturnType<typeof setInterval> | null = null
let running = false

// Cache of last-known stock prices from preloader cycles
const stockPriceCache = new Map<string, number>()

/**
 * Get the cached stock price for a symbol (populated by the preloader).
 * Returns null if not yet fetched.
 */
export function getCachedStockPrice(symbol: string): number | null {
  return stockPriceCache.get(symbol.toUpperCase()) ?? null
}

/**
 * Start the background preloader.  Safe to call multiple times —
 * subsequent calls are no-ops while the preloader is already running.
 */
export function startOptionPreloader(): void {
  if (running) return
  running = true
  console.log('[Preloader] Starting option chain preloader for', PRELOAD_SYMBOLS.join(', '))

  // Initial preload (staggered so we don't flood IB)
  preloadAll()

  // Periodic refresh
  refreshTimer = setInterval(() => {
    preloadAll()
  }, REFRESH_INTERVAL_MS)
}

/**
 * Stop the background preloader and clear timers.
 */
export function stopOptionPreloader(): void {
  if (!running) return
  running = false
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  console.log('[Preloader] Stopped option chain preloader')
}

/**
 * On-demand preload: fetch greeks for a specific symbol+expiry+strikes from IB,
 * store in cache, and return the cached result.
 * Called by the `ib:requestPreload` IPC handler when a dialog needs data not yet cached.
 */
export async function preloadSymbolExpiry(
  symbol: string,
  expiry: string,
  strikes: number[]
): Promise<void> {
  console.log(`[Preloader] On-demand preload: ${symbol} ${expiry} (${strikes.length} strikes)`)
  try {
    await requestOptionGreeks(symbol, expiry, strikes, 'SMART', true)
    console.log(`[Preloader] On-demand cached: ${symbol} ${expiry}`)
  } catch (err) {
    console.warn(`[Preloader] On-demand failed: ${symbol} ${expiry}:`, err)
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────

async function preloadAll(): Promise<void> {
  for (const symbol of PRELOAD_SYMBOLS) {
    try {
      await preloadSymbol(symbol)
    } catch (err) {
      console.warn(`[Preloader] Failed to preload ${symbol}:`, err)
    }
  }
}

async function preloadSymbol(symbol: string): Promise<void> {
  // 1. Chain params (fills chainParamsCache inside options.ts)
  const params = await requestOptionChain(symbol)
  if (params.length === 0) {
    console.warn(`[Preloader] No chain params for ${symbol}`)
    return
  }

  // 2. Current stock price
  let stockPrice: number | null = null
  try {
    const q = await getStockQuote(symbol)
    stockPrice =
      q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
    if (stockPrice !== null) {
      stockPriceCache.set(symbol.toUpperCase(), stockPrice)
      console.log(`[Preloader] Cached stock price for ${symbol}: ${stockPrice}`)
    }
  } catch {
    // non-fatal
  }

  // 3. Determine expirations & strikes to preload
  const allExpirations = new Set<string>()
  const allStrikes = new Set<number>()
  for (const p of params) {
    p.expirations.forEach((e) => allExpirations.add(e))
    p.strikes.forEach((s) => allStrikes.add(s))
  }
  const sortedExpirations = Array.from(allExpirations).sort()
  const sortedStrikes = Array.from(allStrikes)
    .filter((s) => (s * 2) % 1 === 0) // standard strikes only
    .sort((a, b) => a - b)

  // Pick nearest N expirations
  const expirations = sortedExpirations.slice(0, NUM_EXPIRATIONS)

  // Log which tradingClass each expiry belongs to for diagnostics
  for (const exp of expirations) {
    const matchingClasses = params
      .filter((p) => p.expirations.includes(exp))
      .map((p) => `${p.exchange}/${p.tradingClass}`)
    console.log(`[Preloader] Expiry ${exp} found in: ${matchingClasses.join(', ')}`)
  }

  // Pick strikes around current price
  let strikes: number[]
  if (stockPrice !== null) {
    const idx = sortedStrikes.findIndex((s) => s >= stockPrice!)
    const center = idx === -1 ? sortedStrikes.length - 1 : idx
    const start = Math.max(0, center - STRIKES_RADIUS)
    const end = Math.min(sortedStrikes.length, center + STRIKES_RADIUS + 1)
    strikes = sortedStrikes.slice(start, end)
  } else {
    // Fallback: middle 11 strikes
    const mid = Math.floor(sortedStrikes.length / 2)
    strikes = sortedStrikes.slice(Math.max(0, mid - 5), mid + 6)
  }

  // 4. Fetch Greeks for each expiration (sequentially to avoid IB overload)
  for (const exp of expirations) {
    try {
      const greeks = await requestOptionGreeks(symbol, exp, strikes, 'SMART', true)
      // requestOptionGreeks auto-stores in cache with key symbol_expiry
      console.log(
        `[Preloader] Cached ${symbol} ${exp}: ${greeks.filter((g) => g.bid > 0 || g.ask > 0).length}/${greeks.length} with data`
      )
    } catch (err) {
      console.warn(`[Preloader] Greeks error for ${symbol} ${exp}:`, err)
    }
  }
}
