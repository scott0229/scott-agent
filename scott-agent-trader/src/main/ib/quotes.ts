import { Contract, EventName, OptionType, SecType } from '@stoqey/ib'
import { getIBApi } from './connection'

let reqIdCounter = 80000

function getNextReqId(): number {
  return reqIdCounter++
}

// Stock price cache (30s TTL — refreshed by prefetch and user actions)
const STOCK_CACHE_TTL_MS = 30 * 1000
const stockPriceCache = new Map<string, { quote: StockQuote; fetchedAt: number }>()

/**
 * Return the cached stock price for a symbol, or null if not cached / expired.
 */
export function getCachedStockPrice(symbol: string): number | null {
  const entry = stockPriceCache.get(symbol.toUpperCase())
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > STOCK_CACHE_TTL_MS) return null
  const q = entry.quote
  return q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
}

export interface StockQuote {
  symbol: string
  bid: number
  ask: number
  last: number
}

export interface OptionQuoteRequest {
  symbol: string
  expiry: string // e.g. "20260220"
  strike: number
  right: string // "C" or "P"
}

/**
 * Build a unique key for an option contract.
 */
function optionKey(req: OptionQuoteRequest): string {
  return `${req.symbol}|${req.expiry}|${req.strike}|${req.right}`
}

// In-memory cache for option quotes to ensure continuous updates
const optionQuoteCache: Record<string, { price: number; ts: number }> = {}
// Track in-flight requests to avoid duplicate IB API calls
const inflightOptionRequests: Record<string, Promise<number>> = {}

const OPTION_CACHE_TTL = 5000 // 5 seconds

/**
 * Fetch snapshot quote for a single option contract (with caching).
 * If a fresh value exists in cache, returns it immediately.
 * If a request is already in-flight, waits for it instead of creating a duplicate.
 */
export async function getOptionQuote(req: OptionQuoteRequest): Promise<number> {
  const key = optionKey(req)

  // Return cached value if still fresh
  const cached = optionQuoteCache[key]
  if (cached && cached.price > 0 && Date.now() - cached.ts < OPTION_CACHE_TTL) {
    return cached.price
  }

  // If already in-flight, wait for the existing request
  if (key in inflightOptionRequests) {
    return inflightOptionRequests[key]
  }

  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  const promise = _fetchOptionQuote(api, req, key)
  inflightOptionRequests[key] = promise

  try {
    const price = await promise
    return price
  } finally {
    delete inflightOptionRequests[key]
  }
}

function _fetchOptionQuote(
  api: ReturnType<typeof getIBApi> & object,
  req: OptionQuoteRequest,
  key: string
): Promise<number> {
  const reqId = getNextReqId()
  let last = 0
  let close = 0
  let bid = 0
  let ask = 0

  // Use frozen (2) to get best available data:
  // live when available, frozen otherwise (matches TWS behavior and returns greeks)
  api.reqMarketDataType(2)

  return new Promise((resolve) => {
    let resolved = false

    const finalize = (): number => {
      // TWS mark price: bid/ask midpoint 優先 > last (成交) > close (收盤)
      if (ask > 0) return (bid + ask) / 2
      if (last > 0) return last
      if (close > 0) return close
      return 0
    }

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        const price = finalize()
        console.log(
          `[IB] Option quote timeout for ${key}: last=${last} close=${close} bid=${bid} ask=${ask} → ${price}`
        )
        if (price > 0) optionQuoteCache[key] = { price, ts: Date.now() }
        resolve(price)
      }
    }, 3000)

    const onTickPrice = (id: number, tickType: number, value: number): void => {
      if (id !== reqId || resolved) return
      if (value >= 0) {
        // tickType 4=last, 70=delayed_last
        if (tickType === 4 || tickType === 70) last = value
        // tickType 9=close, 75=delayed_close
        else if (tickType === 9 || tickType === 75) close = value
        // bid/ask
        else if (tickType === 1 || tickType === 68) bid = value
        else if (tickType === 2 || tickType === 69) ask = value
      }
    }

    const onTickSnapshotEnd = (id: number): void => {
      if (id !== reqId || resolved) return
      resolved = true
      clearTimeout(timeout)
      cleanup()
      const price = finalize()
      console.log(
        `[IB] Option snapshot end for ${key}: last=${last} close=${close} bid=${bid} ask=${ask} → ${price}`
      )
      if (price > 0) optionQuoteCache[key] = { price, ts: Date.now() }
      resolve(price)
    }

    function cleanup(): void {
      api!.off(EventName.tickPrice, onTickPrice)
      api!.off(EventName.tickSnapshotEnd, onTickSnapshotEnd)
      try {
        api!.cancelMktData(reqId)
      } catch {
        /* ignore */
      }
    }

    api.on(EventName.tickPrice, onTickPrice)
    api.on(EventName.tickSnapshotEnd, onTickSnapshotEnd)

    const r = req.right.toUpperCase()
    const contract: Contract = {
      symbol: req.symbol.toUpperCase(),
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: req.expiry,
      strike: req.strike,
      right: r === 'C' || r === 'CALL' ? OptionType.Call : OptionType.Put
    }

    api.reqMktData(reqId, contract, '', true, false)
  })
}

/**
 * Fetch snapshot quotes for multiple option contracts in parallel.
 * Returns a map of "SYMBOL|EXPIRY|STRIKE|RIGHT" -> last price.
 */
export async function getOptionQuotes(
  contracts: OptionQuoteRequest[]
): Promise<Record<string, number>> {
  console.log(`[IB] getOptionQuotes called for ${contracts.length} contracts`)
  const entries = await Promise.all(
    contracts.map(async (c) => {
      try {
        const price = await getOptionQuote(c)
        return [optionKey(c), price] as const
      } catch {
        return [optionKey(c), 0] as const
      }
    })
  )
  const results = Object.fromEntries(entries)
  console.log(`[IB] getOptionQuotes results:`, results)
  return results
}

/**
 * Request snapshot quotes for multiple symbols and return a map of symbol -> last price.
 * Fetches sequentially to avoid IB API conflicts.
 */
export async function getQuotes(symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))]
  console.log(`[IB] getQuotes called for: ${unique.join(', ')}`)

  // Fetch all quotes in parallel
  const entries = await Promise.all(
    unique.map(async (s) => {
      try {
        const q = await getStockQuote(s)
        return [s, q.last || q.bid || q.ask || 0] as const
      } catch {
        return [s, 0] as const
      }
    })
  )

  const results = Object.fromEntries(entries)
  console.log(`[IB] getQuotes results:`, results)
  return results
}

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const sym = symbol.toUpperCase()

  // Return cached quote if still fresh
  const cached = stockPriceCache.get(sym)
  if (cached && Date.now() - cached.fetchedAt < STOCK_CACHE_TTL_MS) {
    const q = cached.quote
    if (q.last > 0 || q.bid > 0 || q.ask > 0) {
      console.log(`[IB] Stock quote cache hit for ${sym} (age: ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s)`)
      return q
    }
  }

  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  const reqId = getNextReqId()

  const quote: StockQuote = {
    symbol: sym,
    bid: 0,
    ask: 0,
    last: 0
  }

  // Use frozen market data (type 2) to get best available data
  api.reqMarketDataType(2)

  return new Promise((resolve) => {
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`[IB] Quote timeout for ${sym}: last=${quote.last} bid=${quote.bid}`)
        stockPriceCache.set(sym, { quote, fetchedAt: Date.now() })
        resolve(quote)
      }
    }, 3000)

    const onTickPrice = (id: number, tickType: number, value: number): void => {
      if (id !== reqId || resolved) return
      console.log(`[IB] tick ${symbol}: type=${tickType} value=${value}`)
      if (value >= 0) {
        // tickType 1=bid, 2=ask, 4=last, 9=close
        // tickType 68=delayed_bid, 69=delayed_ask, 70=delayed_last, 75=delayed_close
        if (tickType === 1 || tickType === 68) quote.bid = value
        else if (tickType === 2 || tickType === 69) quote.ask = value
        else if (tickType === 4 || tickType === 70) quote.last = value
        else if ((tickType === 9 || tickType === 75) && quote.last === 0) quote.last = value
      }
    }

    const onTickSnapshotEnd = (id: number): void => {
      if (id !== reqId || resolved) return
      resolved = true
      clearTimeout(timeout)
      cleanup()
      console.log(`[IB] Snapshot end for ${sym}: last=${quote.last} bid=${quote.bid}`)
      stockPriceCache.set(sym, { quote, fetchedAt: Date.now() })
      resolve(quote)
    }

    function cleanup(): void {
      api!.off(EventName.tickPrice, onTickPrice)
      api!.off(EventName.tickSnapshotEnd, onTickSnapshotEnd)
      try {
        api!.cancelMktData(reqId)
      } catch {
        /* ignore */
      }
    }

    api.on(EventName.tickPrice, onTickPrice)
    api.on(EventName.tickSnapshotEnd, onTickSnapshotEnd)

    const contract: Contract = {
      symbol: symbol.toUpperCase(),
      secType: SecType.STK,
      exchange: 'SMART',
      currency: 'USD'
    }

    api.reqMktData(reqId, contract, '', true, false)
    console.log(`[IB] Requesting stock quote for ${symbol.toUpperCase()} (reqId: ${reqId})`)
  })
}

// ════════════════════════════════════════════════════
//  Streaming Market Data Engine
// ════════════════════════════════════════════════════

type QuoteUpdateCallback = (data: {
  quotes: Record<string, number>
  optionQuotes: Record<string, number>
}) => void

// Live price maps — updated on every tick
const liveStockPrices: Record<string, number> = {}
const liveOptionPrices: Record<string, number> = {}

// reqId → symbol/key mapping for cleanup
const streamingStockReqs = new Map<number, string>() // reqId → symbol
const streamingOptionReqs = new Map<number, string>() // reqId → optionKey

// Global tick handler reference (for cleanup)
let streamTickHandler: ((id: number, tickType: number, value: number) => void) | null = null
let streamCallback: QuoteUpdateCallback | null = null
let throttleTimer: ReturnType<typeof setTimeout> | null = null

function emitUpdate(): void {
  if (!streamCallback) return
  if (throttleTimer) return // already scheduled
  throttleTimer = setTimeout(() => {
    throttleTimer = null
    if (streamCallback) {
      streamCallback({
        quotes: { ...liveStockPrices },
        optionQuotes: { ...liveOptionPrices }
      })
    }
  }, 500)
}

/**
 * Subscribe to streaming stock quotes.
 * Calls callback with updated price map whenever ticks arrive (throttled to ~500ms).
 */
export function subscribeStockQuotes(symbols: string[], callback: QuoteUpdateCallback): void {
  const api = getIBApi()
  if (!api) return

  streamCallback = callback

  // Use frozen (2) for best available data
  api.reqMarketDataType(2)

  // Install global tick handler if not already done
  if (!streamTickHandler) {
    streamTickHandler = (id: number, tickType: number, value: number): void => {
      if (value < 0) return

      // Check stock subscriptions
      const stockSym = streamingStockReqs.get(id)
      if (stockSym) {
        // 4=last, 70=delayed_last, 9=close, 75=delayed_close
        if (tickType === 4 || tickType === 70) {
          liveStockPrices[stockSym] = value
          // Also update snapshot cache so dialogs see fresh prices
          const entry = stockPriceCache.get(stockSym)
          if (entry) {
            entry.quote.last = value
            entry.fetchedAt = Date.now()
          } else {
            stockPriceCache.set(stockSym, {
              quote: { symbol: stockSym, bid: 0, ask: 0, last: value },
              fetchedAt: Date.now()
            })
          }
          emitUpdate()
        } else if (tickType === 9 || tickType === 75) {
          if (!liveStockPrices[stockSym]) {
            liveStockPrices[stockSym] = value
            emitUpdate()
          }
        } else if (tickType === 1 || tickType === 68) {
          // bid — use mid if we have ask
          const entry = stockPriceCache.get(stockSym)
          if (entry) entry.quote.bid = value
        } else if (tickType === 2 || tickType === 69) {
          // ask
          const entry = stockPriceCache.get(stockSym)
          if (entry) entry.quote.ask = value
        }
        return
      }

      // Check option subscriptions
      const optKey = streamingOptionReqs.get(id)
      if (optKey) {
        if (tickType === 1 || tickType === 68) {
          // bid — store temporarily
          const cur = optionQuoteCache[optKey]
          if (!cur) optionQuoteCache[optKey] = { price: 0, ts: Date.now() }
          ;(optionQuoteCache[optKey] as any)._bid = value
        } else if (tickType === 2 || tickType === 69) {
          // ask — compute mid
          const cur = optionQuoteCache[optKey] as any
          const bid = cur?._bid || 0
          if (bid > 0 && value > 0) {
            const mid = (bid + value) / 2
            liveOptionPrices[optKey] = mid
            optionQuoteCache[optKey] = { price: mid, ts: Date.now() }
            emitUpdate()
          }
        } else if (tickType === 4 || tickType === 70) {
          // last
          liveOptionPrices[optKey] = value
          optionQuoteCache[optKey] = { price: value, ts: Date.now() }
          emitUpdate()
        } else if (tickType === 9 || tickType === 75) {
          // close — fallback
          if (!liveOptionPrices[optKey]) {
            liveOptionPrices[optKey] = value
            optionQuoteCache[optKey] = { price: value, ts: Date.now() }
            emitUpdate()
          }
        }
      }
    }
    api.on(EventName.tickPrice, streamTickHandler)
    console.log('[IB-Stream] Installed global tick handler')
  }

  // Subscribe to each symbol (skip already-subscribed)
  const activeSymbols = new Set(streamingStockReqs.values())
  for (const rawSym of symbols) {
    const sym = rawSym.toUpperCase()
    if (activeSymbols.has(sym)) continue

    const reqId = getNextReqId()
    streamingStockReqs.set(reqId, sym)

    const contract: Contract = {
      symbol: sym,
      secType: SecType.STK,
      exchange: 'SMART',
      currency: 'USD'
    }

    api.reqMktData(reqId, contract, '', false, false) // snapshot=false → streaming
    console.log(`[IB-Stream] Subscribed stock ${sym} (reqId: ${reqId})`)
  }
}

/**
 * Subscribe to streaming option quotes.
 */
export function subscribeOptionQuotes(
  contracts: OptionQuoteRequest[],
  callback: QuoteUpdateCallback
): void {
  const api = getIBApi()
  if (!api) return

  streamCallback = callback
  api.reqMarketDataType(2)

  // Install global tick handler if not already done
  if (!streamTickHandler) {
    // This shouldn't happen if subscribeStockQuotes is called first,
    // but just in case:
    subscribeStockQuotes([], callback)
  }

  const activeKeys = new Set(streamingOptionReqs.values())
  for (const req of contracts) {
    const key = optionKey(req)
    if (activeKeys.has(key)) continue

    const reqId = getNextReqId()
    streamingOptionReqs.set(reqId, key)

    const r = req.right.toUpperCase()
    const contract: Contract = {
      symbol: req.symbol.toUpperCase(),
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: req.expiry,
      strike: req.strike,
      right: r === 'C' || r === 'CALL' ? OptionType.Call : OptionType.Put
    }

    api.reqMktData(reqId, contract, '', false, false) // streaming
    console.log(`[IB-Stream] Subscribed option ${key} (reqId: ${reqId})`)
  }
}

/**
 * Unsubscribe all streaming quotes and clean up.
 */
export function unsubscribeAllQuotes(): void {
  const api = getIBApi()

  // Cancel all stock subscriptions
  for (const [reqId, sym] of streamingStockReqs) {
    try {
      api?.cancelMktData(reqId)
    } catch { /* ignore */ }
    console.log(`[IB-Stream] Unsubscribed stock ${sym} (reqId: ${reqId})`)
  }
  streamingStockReqs.clear()

  // Cancel all option subscriptions
  for (const [reqId, key] of streamingOptionReqs) {
    try {
      api?.cancelMktData(reqId)
    } catch { /* ignore */ }
    console.log(`[IB-Stream] Unsubscribed option ${key} (reqId: ${reqId})`)
  }
  streamingOptionReqs.clear()

  // Remove tick handler
  if (streamTickHandler && api) {
    api.off(EventName.tickPrice, streamTickHandler)
  }
  streamTickHandler = null
  streamCallback = null
  if (throttleTimer) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }

  // Clear live prices
  Object.keys(liveStockPrices).forEach(k => delete liveStockPrices[k])
  Object.keys(liveOptionPrices).forEach(k => delete liveOptionPrices[k])

  console.log('[IB-Stream] All subscriptions cleared')
}

/**
 * Get current live prices (for immediate reads without waiting for next tick).
 */
export function getLiveQuotes(): {
  quotes: Record<string, number>
  optionQuotes: Record<string, number>
} {
  return {
    quotes: { ...liveStockPrices },
    optionQuotes: { ...liveOptionPrices }
  }
}
