import { Contract, EventName, OptionType, SecType } from '@stoqey/ib'
import { getIBApi } from './connection'

let reqIdCounter = 80000

function getNextReqId(): number {
  return reqIdCounter++
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

  api.reqMarketDataType(4)

  return new Promise((resolve) => {
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`[IB] Option quote timeout for ${key}: last=${last}`)
        if (last > 0) optionQuoteCache[key] = { price: last, ts: Date.now() }
        resolve(last)
      }
    }, 3000)

    const onTickPrice = (id: number, tickType: number, value: number): void => {
      if (id !== reqId || resolved) return
      if (value >= 0) {
        // tickType 4=last, 70=delayed_last, 9=close, 75=delayed_close
        if (tickType === 4 || tickType === 70) last = value
        else if ((tickType === 9 || tickType === 75) && last === 0) last = value
        // bid/ask as fallback
        else if ((tickType === 1 || tickType === 68) && last === 0) last = value
        else if ((tickType === 2 || tickType === 69) && last === 0) last = value
      }
    }

    const onTickSnapshotEnd = (id: number): void => {
      if (id !== reqId || resolved) return
      resolved = true
      clearTimeout(timeout)
      cleanup()
      console.log(`[IB] Option snapshot end for ${key}: last=${last}`)
      if (last > 0) optionQuoteCache[key] = { price: last, ts: Date.now() }
      resolve(last)
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
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  const reqId = getNextReqId()

  const quote: StockQuote = {
    symbol: symbol.toUpperCase(),
    bid: 0,
    ask: 0,
    last: 0
  }

  // Request frozen/delayed data so we get close prices when market is closed
  api.reqMarketDataType(4)

  return new Promise((resolve) => {
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`[IB] Quote timeout for ${symbol}: last=${quote.last} bid=${quote.bid}`)
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
      console.log(`[IB] Snapshot end for ${symbol}: last=${quote.last} bid=${quote.bid}`)
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
