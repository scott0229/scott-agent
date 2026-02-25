import { Contract, SecType, EventName, OptionType, Option } from '@stoqey/ib'
import { getIBApi } from './connection'

export interface OptionChainParams {
  exchange: string
  underlyingConId: number
  tradingClass: string
  multiplier: string
  expirations: string[]
  strikes: number[]
}

export interface OptionGreek {
  strike: number
  right: 'C' | 'P'
  expiry: string
  bid: number
  ask: number
  last: number
  delta: number
  gamma: number
  theta: number
  vega: number
  impliedVol: number
  openInterest: number
}

let reqIdCounter = 200000

function getNextReqId(): number {
  return reqIdCounter++
}

// Cache resolved conIds so we don't re-request on every chain refresh
const conIdCache = new Map<string, number>()

// Cache option chain params — valid for 5 minutes (chain structure doesn't change mid-session)
interface CachedChain {
  params: OptionChainParams[]
  fetchedAt: number
}
const chainParamsCache = new Map<string, CachedChain>()
const CHAIN_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Cache greeks data — populated by preloader, consumed by requestOptionGreeks
interface CachedGreeks {
  greeks: OptionGreek[]
  fetchedAt: number
}
const greeksCache = new Map<string, CachedGreeks>()
const GREEKS_CACHE_TTL_MS = 30_000 // 30 seconds

/** Build cache key for greeks lookup — keyed by symbol+expiry only so
 *  different strike lists can still hit the same cache entry. */
function buildGreeksCacheKey(symbol: string, expiry: string): string {
  return `${symbol}_${expiry}`
}

/** Merge a single greek into an existing one, only overwriting fields with meaningful (non-zero) values */
function mergeGreek(old: OptionGreek, incoming: OptionGreek): OptionGreek {
  return {
    strike: old.strike,
    right: old.right,
    expiry: old.expiry,
    bid: incoming.bid > 0 ? incoming.bid : old.bid,
    ask: incoming.ask > 0 ? incoming.ask : old.ask,
    last: incoming.last > 0 ? incoming.last : old.last,
    delta: incoming.delta !== 0 ? incoming.delta : old.delta,
    gamma: incoming.gamma !== 0 ? incoming.gamma : old.gamma,
    theta: incoming.theta !== 0 ? incoming.theta : old.theta,
    vega: incoming.vega !== 0 ? incoming.vega : old.vega,
    impliedVol: incoming.impliedVol > 0 ? incoming.impliedVol : old.impliedVol,
    openInterest: incoming.openInterest > 0 ? incoming.openInterest : old.openInterest
  }
}

/** Store greeks in cache, merging with any existing cached data for the same key */
export function setGreeksCache(key: string, greeks: OptionGreek[]): void {
  const existing = greeksCache.get(key)
  if (existing) {
    // Merge: field-level — only non-zero new values overwrite existing ones
    const map = new Map<string, OptionGreek>()
    for (const g of existing.greeks) map.set(`${g.strike}_${g.right}`, g)
    for (const g of greeks) {
      const prev = map.get(`${g.strike}_${g.right}`)
      map.set(`${g.strike}_${g.right}`, prev ? mergeGreek(prev, g) : g)
    }
    greeksCache.set(key, { greeks: Array.from(map.values()), fetchedAt: Date.now() })
  } else {
    greeksCache.set(key, { greeks, fetchedAt: Date.now() })
  }
}

/**
 * Read greeks from cache for a given symbol+expiry without touching IB.
 * Returns all cached greeks (all strikes, both calls and puts).
 * Returns empty array if not yet cached.
 */
export function getCachedGreeks(symbol: string, expiry: string): OptionGreek[] {
  const key = buildGreeksCacheKey(symbol, expiry)
  const cached = greeksCache.get(key)
  if (!cached) return []
  return cached.greeks
}

/**
 * Request the option chain parameters (available expirations and strikes)
 * for the given underlying symbol.
 */
export async function requestOptionChain(symbol: string): Promise<OptionChainParams[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  // Return cached chain if still fresh (avoids 3-4s IB round-trip on every dialog open)
  const cached = chainParamsCache.get(symbol)
  if (cached && Date.now() - cached.fetchedAt < CHAIN_CACHE_TTL_MS) {
    console.log(`[IB] Option chain cache hit for ${symbol} (age: ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s)`)
    return cached.params
  }

  // First, get the conId for the underlying stock
  const conId = await getUnderlyingConId(symbol)

  return new Promise((resolve, reject) => {
    const reqId = getNextReqId()
    const results: OptionChainParams[] = []
    let finished = false

    const cleanup = (): void => {
      clearTimeout(timeout)
      api.removeListener(EventName.securityDefinitionOptionParameter, onParam)
      api.removeListener(EventName.securityDefinitionOptionParameterEnd, onEnd)
    }

    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error('Option chain request timed out'))
    }, 15000)

    const onParam = (
      id: number,
      exchange: string,
      underlyingConId: number,
      tradingClass: string,
      multiplier: string,
      expirations: string[],
      strikes: number[]
    ): void => {
      if (id !== reqId) return
      results.push({
        exchange,
        underlyingConId,
        tradingClass,
        multiplier,
        expirations: expirations.sort(),
        strikes: strikes.sort((a, b) => a - b)
      })
    }

    const onEnd = (id: number): void => {
      if (id !== reqId) return
      if (finished) return
      finished = true
      cleanup()
      // Store in cache for subsequent dialog opens
      chainParamsCache.set(symbol, { params: results, fetchedAt: Date.now() })
      console.log(`[IB] Option chain cached for ${symbol} (${results.length} exchanges)`)
      resolve(results)
    }

    api.on(EventName.securityDefinitionOptionParameter, onParam)
    api.on(EventName.securityDefinitionOptionParameterEnd, onEnd)

    api.reqSecDefOptParams(reqId, symbol, '', 'STK', conId)
    console.log(`[IB] Requesting option chain for ${symbol} (conId: ${conId}, reqId: ${reqId})`)
  })
}



/**
 * Get the contract ID for an underlying stock symbol.
 */
async function getUnderlyingConId(symbol: string): Promise<number> {
  // Return cached value if available
  if (conIdCache.has(symbol)) return conIdCache.get(symbol)!

  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  return new Promise((resolve, reject) => {
    const reqId = getNextReqId()
    const timeout = setTimeout(() => {
      reject(new Error(`Could not resolve conId for ${symbol}`))
    }, 10000)

    const contract: Contract = {
      symbol,
      secType: SecType.STK,
      exchange: 'SMART',
      currency: 'USD'
    }

    const onDetails = (id: number, details: any) => {
      if (id !== reqId) return
      clearTimeout(timeout)
      api.removeListener(EventName.contractDetails, onDetails)
      api.removeListener(EventName.error, onErr)
      const cid = details.contract.conId
      conIdCache.set(symbol, cid)
      resolve(cid)
    }

    const onErr = (err: Error, _code: number, id: number) => {
      if (id !== reqId) return
      clearTimeout(timeout)
      api.removeListener(EventName.contractDetails, onDetails)
      api.removeListener(EventName.error, onErr)
      reject(new Error(`Failed to get contract details for ${symbol}: ${err.message}`))
    }

    api.on(EventName.contractDetails, onDetails)
    api.on(EventName.error, onErr)
    api.reqContractDetails(reqId, contract)
  })
}

/**
 * Request market data (bid/ask/greeks) for a batch of option contracts.
 * When forceRefresh=false (default, used by dialogs): always returns from cache.
 * When forceRefresh=true (used by preloader): bypasses cache and fetches from IB.
 */
export async function requestOptionGreeks(
  symbol: string,
  expiry: string,
  strikes: number[],
  exchange: string = 'SMART',
  forceRefresh: boolean = false
): Promise<OptionGreek[]> {
  const cacheKey = buildGreeksCacheKey(symbol, expiry)
  const cached = greeksCache.get(cacheKey)

  // Dialogs (forceRefresh=false): return from cache when available
  // If cache exists (even with empty data), always return from cache to avoid overwhelming IB.
  // If NO cache entry at all, fall through to fetch from IB (one-time bootstrap).
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < GREEKS_CACHE_TTL_MS) {
    const strikeSet = new Set(strikes)
    const filtered = cached.greeks.filter((g) => strikeSet.has(g.strike))
    const withData = filtered.filter((g) => g.bid > 0 || g.ask > 0 || g.last > 0)
    console.log(`[IB] Greeks cache hit for ${symbol} ${expiry} (age: ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s, ${filtered.length}/${strikes.length * 2} matched, ${withData.length} with data)`)
    return filtered
  }
  if (!forceRefresh && cached) {
    // Cache exists but expired — still return stale cache for dialogs (preloader will refresh)
    const strikeSet = new Set(strikes)
    const filtered = cached.greeks.filter((g) => strikeSet.has(g.strike))
    console.log(`[IB] Greeks stale cache for ${symbol} ${expiry} (age: ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s, returning stale)`)
    return filtered
  }
  // No cache entry at all — allow one-time IB fetch (bootstrap)
  if (!forceRefresh) {
    console.log(`[IB] Greeks cache MISS for ${symbol} ${expiry} — bootstrapping from IB`)
  }

  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  // Resolve tradingClass from cached option chain for this expiry
  // IB requires tradingClass to disambiguate weekly/daily vs monthly options
  let tradingClass: string | undefined
  const chainCached = chainParamsCache.get(symbol)
  if (chainCached) {
    // Prefer chain entry matching our exchange (usually SMART), fallback to any
    const preferred = chainCached.params.find(
      (p) => p.exchange === exchange && p.expirations.includes(expiry)
    )
    const fallback = chainCached.params.find((p) => p.expirations.includes(expiry))
    const matched = preferred || fallback
    if (matched) {
      tradingClass = matched.tradingClass
    }
    // Log chain structure for diagnostics (first call only per expiry)
    console.log(
      `[IB] Chain entries for ${symbol}: ${chainCached.params.map((p) => `${p.exchange}/${p.tradingClass}(${p.expirations.length}exp)`).join(', ')}`
    )
    console.log(
      `[IB] Resolved tradingClass for expiry ${expiry}: ${tradingClass ?? 'none'} (matched exchange: ${matched?.exchange ?? 'none'})`
    )
  }

  console.log(
    `[IB] requestOptionGreeks called: symbol=${symbol}, expiry=${expiry}, strikes=${strikes.length}, exchange=${exchange}, tradingClass=${tradingClass ?? 'none'}`
  )

  // Use frozen market data (type 2) to get last known bid/ask from market close
  // Type 1 (live) returns -1 when market is closed; type 2 (frozen) returns last snapshot
  api.reqMarketDataType(2)

  const results: OptionGreek[] = []
  const reqIds: Map<number, { strike: number; right: 'C' | 'P' }> = new Map()
  const greeksMap: Map<string, Partial<OptionGreek>> = new Map()

  // Create requests for both calls and puts at each strike
  for (const strike of strikes) {
    for (const right of ['C', 'P'] as const) {
      const reqId = getNextReqId()
      reqIds.set(reqId, { strike, right })

      const key = `${strike}_${right}`
      greeksMap.set(key, {
        strike,
        right,
        expiry,
        bid: 0,
        ask: 0,
        last: 0,
        delta: 0,
        gamma: 0,
        theta: 0,
        vega: 0,
        impliedVol: 0,
        openInterest: 0
      })
    }
  }

  return new Promise((resolve) => {
    let resolved = false
    let completedCount = 0
    const totalExpected = reqIds.size
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let tickDataReceived = 0
    const errorReqIds = new Set<number>()

    // Hard timeout: safety net
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.log(
          `[IB] Hard timeout fired. tickDataReceived=${tickDataReceived}, errors=${errorReqIds.size}, completed=${completedCount}/${totalExpected}`
        )
        finish()
      }
    }, 8000)

    // "Settle" timer: resolve early once data stops flowing for 200ms
    function resetSettleTimer(): void {
      if (resolved) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        if (!resolved) {
          console.log(
            `[IB] Settle timer fired, tickDataReceived=${tickDataReceived}, completed=${completedCount}/${totalExpected}`
          )
          finish()
        }
      }, 500)
    }

    function finish(): void {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      if (settleTimer) clearTimeout(settleTimer)
      cleanup()
      buildResults()
      console.log(
        `[IB] Option greeks finished: ${results.filter((r) => r.bid > 0 || r.ask > 0 || r.delta !== 0).length}/${results.length} have data`
      )
      // Auto-store fetched results in greeks cache
      setGreeksCache(cacheKey, results)
      resolve(results)
    }

    // tickPrice: bid(1), ask(2), last(4), close(9)
    // Delayed: bid(68), ask(69), last(70), close(75)
    // IB returns -1 for "no data available", so accept value >= 0
    const onTickPrice = (reqId: number, tickType: number, value: number): void => {
      const info = reqIds.get(reqId)
      if (!info) return
      const key = `${info.strike}_${info.right}`
      const data = greeksMap.get(key)
      if (!data) return

      // Log first few ticks for debugging
      if (tickDataReceived < 5) {
        console.log(`[IB] Option tick: ${info.strike}${info.right} type=${tickType} value=${value}`)
      }

      tickDataReceived++
      if (value >= 0) {
        if (tickType === 1 || tickType === 68) data.bid = value
        else if (tickType === 2 || tickType === 69) data.ask = value
        else if (tickType === 4 || tickType === 70) data.last = value
        else if (tickType === 9 || tickType === 75) {
          // Close price: use as last if last is still 0
          if (data.last === 0) data.last = value
        }
      }
      resetSettleTimer()
    }

    // tickOptionComputation: handle all field types
    // field 10 = bid computation, 11 = ask computation, 12 = last computation, 13 = model computation
    const onTickOptionComputation = (
      reqId: number,
      field: number,
      impliedVol?: number,
      delta?: number,
      _optPrice?: number,
      _pvDividend?: number,
      gamma?: number,
      vega?: number,
      theta?: number
    ): void => {
      const info = reqIds.get(reqId)
      if (!info) return
      const key = `${info.strike}_${info.right}`
      const data = greeksMap.get(key)
      if (!data) return

      tickDataReceived++

      // Accept greeks from model (13) or any computation that has valid data
      // Prefer model (13), but use bid/ask/last (10/11/12) as fallback
      if (field === 13 || field === 10 || field === 11 || field === 12) {
        const isModel = field === 13
        if (impliedVol !== undefined && isFinite(impliedVol) && impliedVol > 0) {
          if (isModel || data.impliedVol === 0) data.impliedVol = impliedVol
        }
        if (delta !== undefined && isFinite(delta)) {
          if (isModel || data.delta === 0) data.delta = delta
        }
        if (gamma !== undefined && isFinite(gamma)) {
          if (isModel || data.gamma === 0) data.gamma = gamma
        }
        if (vega !== undefined && isFinite(vega)) {
          if (isModel || data.vega === 0) data.vega = vega
        }
        if (theta !== undefined && isFinite(theta)) {
          if (isModel || data.theta === 0) data.theta = theta
        }
      }
      resetSettleTimer()
    }

    const onTickSnapshotEnd = (reqId: number): void => {
      if (!reqIds.has(reqId)) return
      completedCount++
      if (completedCount >= totalExpected) {
        finish()
      }
    }

    // Listen for errors on our reqIds
    const onError = (err: Error, code: number, id: number): void => {
      if (!reqIds.has(id)) return
      errorReqIds.add(id)
      // Only log first few errors to avoid flooding
      if (errorReqIds.size <= 3) {
        const info = reqIds.get(id)
        console.log(
          `[IB] Option data error for ${info?.strike} ${info?.right}: code=${code}, msg=${err.message}`
        )
      }
      // Count errors as completed to avoid hanging
      completedCount++
      if (completedCount >= totalExpected) {
        finish()
      }
    }

    function cleanup(): void {
      api!.removeListener(EventName.tickPrice, debugTickListener)
      api!.removeListener(EventName.tickPrice, onTickPrice)
      api!.removeListener(EventName.tickOptionComputation, onTickOptionComputation)
      api!.removeListener(EventName.tickSnapshotEnd, onTickSnapshotEnd)
      api!.removeListener(EventName.error, onError)
      // Cancel market data requests
      for (const reqId of reqIds.keys()) {
        try {
          api!.cancelMktData(reqId)
        } catch {
          // ignore
        }
      }
    }

    function buildResults(): void {
      for (const data of greeksMap.values()) {
        results.push(data as OptionGreek)
      }
      // Sort by strike ascending, calls first
      results.sort((a, b) => a.strike - b.strike || (a.right === 'C' ? -1 : 1))
    }

    // Log reqId range for debugging
    const reqIdKeys = Array.from(reqIds.keys())
    console.log(`[IB] Option reqId range: ${reqIdKeys[0]} to ${reqIdKeys[reqIdKeys.length - 1]}`)

    // Temporary debug: log first 3 tickPrice events for ANY reqId to verify events arrive
    let debugTickCount = 0
    const debugTickListener = (rId: number, tt: number, val: number): void => {
      if (debugTickCount < 3) {
        console.log(
          `[IB] DEBUG tickPrice: reqId=${rId}, type=${tt}, value=${val}, isOurs=${reqIds.has(rId)}`
        )
        debugTickCount++
      }
    }
    api.on(EventName.tickPrice, debugTickListener)

    api.on(EventName.tickPrice, onTickPrice)
    api.on(EventName.tickOptionComputation, onTickOptionComputation)
    api.on(EventName.tickSnapshotEnd, onTickSnapshotEnd)
    api.on(EventName.error, onError)

    // Request snapshot market data for each option contract
    // Use small delay between requests to avoid overwhelming IB
    let requestIndex = 0
    const allReqEntries = Array.from(reqIds.entries())

    function sendNextBatch(): void {
      // Set market data type to frozen RIGHT BEFORE each batch
      // (quotes.ts auto-refresh may set it to 4 between batches)
      api!.reqMarketDataType(2)

      // Send up to 10 requests at a time
      const batchSize = 20
      const end = Math.min(requestIndex + batchSize, allReqEntries.length)

      for (let i = requestIndex; i < end; i++) {
        const [reqId, info] = allReqEntries[i]
        const contract: Contract = new Option(
          symbol,
          expiry,
          info.strike,
          info.right === 'C' ? OptionType.Call : OptionType.Put,
          exchange,
          'USD'
        )
        // Set tradingClass to disambiguate weekly/daily vs monthly options
        if (tradingClass) {
          contract.tradingClass = tradingClass
        }

        // Log first contract for debugging
        if (i === 0) {
          console.log('[IB] First option contract:', JSON.stringify(contract))
        }

        api!.reqMktData(reqId, contract, '', true, false)
      }

      requestIndex = end
      if (requestIndex < allReqEntries.length) {
        // Schedule next batch with a small delay
        setTimeout(sendNextBatch, 20)
      }
    }

    console.log(
      `[IB] Requesting greeks for ${strikes.length} strikes x 2 (C/P) = ${totalExpected} contracts, expiry ${expiry}`
    )

    sendNextBatch()

    // NOTE: Do NOT call resetSettleTimer() here!
    // Option data takes 4-6 seconds to start arriving from IB.
    // The settle timer should only start after the FIRST tick data arrives.
    // The hard timeout (8s) is the safety net if no data comes at all.
  })
}
