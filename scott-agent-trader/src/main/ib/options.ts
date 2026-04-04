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
  modelPrice: number
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
const CHAIN_CACHE_TTL_MS = 60 * 60 * 1000 // 60 minutes

// Cache greeks data — updated continuously by streaming subscriptions
interface CachedGreeks {
  greeks: OptionGreek[]
  fetchedAt: number
}
const greeksCache = new Map<string, CachedGreeks>()

// Serialization queue: only one initial subscription runs at a time
// This prevents exceeding IB's ~100 concurrent market data request limit.
let greeksQueue: Promise<unknown> = Promise.resolve()

/** Build cache key for greeks lookup — keyed by symbol+expiry only */
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
    openInterest: incoming.openInterest > 0 ? incoming.openInterest : old.openInterest,
    modelPrice: incoming.modelPrice > 0 ? incoming.modelPrice : old.modelPrice
  }
}

/** Store greeks in cache, merging with any existing cached data for the same key */
export function setGreeksCache(key: string, greeks: OptionGreek[]): void {
  const existing = greeksCache.get(key)
  if (existing) {
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
 * Look up the tradingClass for a given symbol+expiry from the cached chain params.
 */
export function getTradingClass(symbol: string, expiry: string): string | undefined {
  const cached = chainParamsCache.get(symbol)
  if (!cached) return undefined
  const preferred = cached.params.find(
    (p) => p.exchange === 'SMART' && p.expirations.includes(expiry)
  )
  const fallback = cached.params.find((p) => p.expirations.includes(expiry))
  return (preferred || fallback)?.tradingClass
}

/**
 * Request the option chain parameters (available expirations and strikes)
 * for the given underlying symbol.
 */
export async function requestOptionChain(symbol: string): Promise<OptionChainParams[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  const cached = chainParamsCache.get(symbol)
  if (cached && Date.now() - cached.fetchedAt < CHAIN_CACHE_TTL_MS) {
    console.log(
      `[IB] Option chain cache hit for ${symbol} (age: ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s)`
    )
    return cached.params
  }

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onDetails = (id: number, details: any): void => {
      if (id !== reqId) return
      clearTimeout(timeout)
      api.removeListener(EventName.contractDetails, onDetails)
      api.removeListener(EventName.error, onErr)
      const cid = details.contract.conId
      conIdCache.set(symbol, cid)
      resolve(cid)
    }

    const onErr = (err: Error, _code: number, id: number): void => {
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

// ── Streaming subscription infrastructure ──────────────────────────────

interface StreamingSubscription {
  symbol: string
  expiry: string
  reqIds: Map<number, { strike: number; right: 'C' | 'P' }>
  greeksMap: Map<string, Partial<OptionGreek>>
  errorReqIds: Set<number>
  listeners: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onTickPrice: (...args: any[]) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onTickOptionComputation: (...args: any[]) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (...args: any[]) => void
  }
}

// Active streaming subscriptions keyed by "SYMBOL_EXPIRY"
const activeSubscriptions = new Map<string, StreamingSubscription>()

// Keys currently being subscribed (prevents duplicates while initial data loads)
const pendingSubscriptions = new Set<string>()

/** Cancel all streaming subscriptions for a given symbol */
export function cancelOptionGreeksSubscriptions(symbol: string): void {
  const api = getIBApi()
  const keysToRemove: string[] = []

  for (const [key, sub] of activeSubscriptions.entries()) {
    if (sub.symbol === symbol) {
      keysToRemove.push(key)
      if (api) {
        api.removeListener(EventName.tickPrice, sub.listeners.onTickPrice)
        api.removeListener(EventName.tickOptionComputation, sub.listeners.onTickOptionComputation)
        api.removeListener(EventName.error, sub.listeners.onError)
        for (const reqId of sub.reqIds.keys()) {
          try {
            api.cancelMktData(reqId)
          } catch {
            // ignore
          }
        }
      }
    }
  }

  for (const key of keysToRemove) {
    activeSubscriptions.delete(key)
    greeksCache.delete(key)
  }

  if (keysToRemove.length > 0) {
    console.log(`[IB] Cancelled ${keysToRemove.length} streaming subscription(s) for ${symbol}`)
  }
}

/** Get sorted results from a live subscription's greeksMap */
function getSubscriptionResults(sub: StreamingSubscription): OptionGreek[] {
  // Apply model price fallback for entries with no live price
  for (const data of sub.greeksMap.values()) {
    if (
      (data.bid ?? 0) === 0 &&
      (data.ask ?? 0) === 0 &&
      (data.last ?? 0) === 0 &&
      (data.modelPrice ?? 0) > 0
    ) {
      data.last = data.modelPrice
    }
  }

  // Exclude error entries
  const errorKeys = new Set<string>()
  for (const errReqId of sub.errorReqIds) {
    const info = sub.reqIds.get(errReqId)
    if (info) errorKeys.add(`${info.strike}_${info.right}`)
  }

  const results = Array.from(sub.greeksMap.entries())
    .filter(([key]) => !errorKeys.has(key))
    .map(([, v]) => v as OptionGreek)

  results.sort((a, b) => a.strike - b.strike || (a.right === 'C' ? -1 : 1))
  return results
}

/**
 * Request market data (bid/ask/greeks) for a batch of option contracts.
 * Uses persistent streaming subscriptions — first call subscribes and waits
 * for initial data; subsequent calls return from the live cache instantly.
 */
export function requestOptionGreeks(
  symbol: string,
  expiry: string,
  strikes: number[],
  exchange: string = 'SMART'
): Promise<OptionGreek[]> {
  const cacheKey = buildGreeksCacheKey(symbol, expiry)

  // If there's an active streaming subscription, check strike coverage
  const existingSub = activeSubscriptions.get(cacheKey)
  if (existingSub) {
    // Find strikes not yet in the subscription
    const subscribedStrikes = new Set<number>()
    for (const info of existingSub.reqIds.values()) {
      subscribedStrikes.add(info.strike)
    }
    const missingStrikes = strikes.filter((s) => !subscribedStrikes.has(s))

    if (missingStrikes.length > 0) {
      // Expand the subscription with missing strikes
      console.log(
        `[IB] Expanding subscription ${symbol} ${expiry}: +${missingStrikes.length} strikes`
      )
      const expandPromise = _expandSubscription(existingSub, cacheKey, missingStrikes, exchange)
      return expandPromise.then(() => {
        const results = getSubscriptionResults(existingSub)
        const strikeSet = new Set(strikes)
        const filtered = results.filter((g) => strikeSet.has(g.strike))
        setGreeksCache(cacheKey, filtered)
        return filtered
      })
    }

    // All strikes covered — return from live cache
    const results = getSubscriptionResults(existingSub)
    const strikeSet = new Set(strikes)
    const filtered = results.filter((g) => strikeSet.has(g.strike))
    console.log(`[IB] Streaming cache hit for ${symbol} ${expiry}: ${filtered.length} items`)
    setGreeksCache(cacheKey, filtered)
    return Promise.resolve(filtered)
  }

  // If subscription is pending (being set up), queue behind it
  const queued = greeksQueue.then(() => _requestOptionGreeksImpl(symbol, expiry, strikes, exchange))
  greeksQueue = queued.catch(() => {})
  return queued
}

/** Expand an existing streaming subscription with additional strikes */
async function _expandSubscription(
  sub: StreamingSubscription,
  _cacheKey: string,
  newStrikes: number[],
  exchange: string
): Promise<void> {
  const api = getIBApi()
  const tradingClass = getTradingClass(sub.symbol, sub.expiry)

  const newReqIds: Array<[number, { strike: number; right: 'C' | 'P' }]> = []

  for (const strike of newStrikes) {
    for (const right of ['C', 'P'] as const) {
      const key = `${strike}_${right}`
      if (sub.greeksMap.has(key)) continue // Already subscribed

      const reqId = getNextReqId()
      const info = { strike, right }
      sub.reqIds.set(reqId, info)
      sub.greeksMap.set(key, {
        strike,
        right,
        expiry: sub.expiry,
        bid: 0,
        ask: 0,
        last: 0,
        delta: 0,
        gamma: 0,
        theta: 0,
        vega: 0,
        impliedVol: 0,
        openInterest: 0,
        modelPrice: 0
      })
      newReqIds.push([reqId, info])
    }
  }

  if (newReqIds.length === 0) return

  console.log(`[IB] Subscribing ${newReqIds.length} new contracts for ${sub.symbol} ${sub.expiry}`)

  // Subscribe to streaming for the new strikes
  if (!api) return
  api.reqMarketDataType(4)
  for (const [reqId, info] of newReqIds) {
    const contract: Contract = new Option(
      sub.symbol,
      sub.expiry,
      info.strike,
      info.right === 'C' ? OptionType.Call : OptionType.Put,
      exchange,
      'USD'
    )
    if (tradingClass) contract.tradingClass = tradingClass
    api.reqMktData(reqId, contract, '', false, false)
  }

  // Wait for enough new contracts to have data, then resolve
  return new Promise((resolve) => {
    let resolved = false

    const doResolve = (reason: string): void => {
      if (resolved) return
      resolved = true
      let withData = 0
      for (const [, info] of newReqIds) {
        const data = sub.greeksMap.get(`${info.strike}_${info.right}`)
        if (data && ((data.bid ?? 0) > 0 || (data.ask ?? 0) > 0 || (data.delta ?? 0) !== 0)) {
          withData++
        }
      }
      console.log(`[IB] Expansion ${reason}: ${withData}/${newReqIds.length} contracts have data`)
      resolve()
    }

    const checkReady = (): void => {
      if (resolved) return
      let withData = 0
      for (const [, info] of newReqIds) {
        const data = sub.greeksMap.get(`${info.strike}_${info.right}`)
        if (data && ((data.bid ?? 0) > 0 || (data.ask ?? 0) > 0 || (data.delta ?? 0) !== 0)) {
          withData++
        }
      }
      if (withData >= 4 || (newReqIds.length > 0 && withData / newReqIds.length >= 0.3)) {
        doResolve(`ready (${withData}/${newReqIds.length})`)
      } else {
        setTimeout(checkReady, 200)
      }
    }

    setTimeout(checkReady, 300)

    // Hard timeout
    setTimeout(() => {
      doResolve('hard timeout')
    }, 3000)
  })
}

async function _requestOptionGreeksImpl(
  symbol: string,
  expiry: string,
  strikes: number[],
  exchange: string = 'SMART'
): Promise<OptionGreek[]> {
  const cacheKey = buildGreeksCacheKey(symbol, expiry)

  // Double-check: subscription may have been created while we were queued
  const existingSub = activeSubscriptions.get(cacheKey)
  if (existingSub) {
    const results = getSubscriptionResults(existingSub)
    const strikeSet = new Set(strikes)
    return results.filter((g) => strikeSet.has(g.strike))
  }

  console.log(`[IB] Subscribing streaming greeks: ${symbol} ${expiry} (${strikes.length} strikes)`)

  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  // Resolve tradingClass
  let tradingClass: string | undefined
  const chainCached = chainParamsCache.get(symbol)
  if (chainCached) {
    const preferred = chainCached.params.find(
      (p) => p.exchange === exchange && p.expirations.includes(expiry)
    )
    const fallback = chainCached.params.find((p) => p.expirations.includes(expiry))
    const matched = preferred || fallback
    if (matched) tradingClass = matched.tradingClass
    console.log(`[IB] Resolved tradingClass for expiry ${expiry}: ${tradingClass ?? 'none'}`)
  }

  // Use delayed-frozen (type 4) for model-computed greeks (delta, gamma, theta, vega)
  api.reqMarketDataType(4)

  const reqIds: Map<number, { strike: number; right: 'C' | 'P' }> = new Map()
  const greeksMap: Map<string, Partial<OptionGreek>> = new Map()

  for (const strike of strikes) {
    for (const right of ['C', 'P'] as const) {
      const reqId = getNextReqId()
      reqIds.set(reqId, { strike, right })
      greeksMap.set(`${strike}_${right}`, {
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
        openInterest: 0,
        modelPrice: 0
      })
    }
  }

  const totalExpected = reqIds.size
  const errorReqIds = new Set<number>()
  let tickDataReceived = 0

  // ── Persistent streaming listeners ──

  const onTickPrice = (reqId: number, tickType: number, value: number): void => {
    const info = reqIds.get(reqId)
    if (!info) return
    const data = greeksMap.get(`${info.strike}_${info.right}`)
    if (!data) return

    tickDataReceived++
    if (value >= 0) {
      if (tickType === 1 || tickType === 68) data.bid = value
      else if (tickType === 2 || tickType === 69) data.ask = value
      else if (tickType === 4 || tickType === 70) data.last = value
      else if (tickType === 9 || tickType === 75) {
        if (data.last === 0) data.last = value
        if (data.bid === 0) data.bid = value
        if (data.ask === 0) data.ask = value
      }
    }
  }

  const onTickOptionComputation = (
    reqId: number,
    field: number,
    impliedVol?: number,
    delta?: number,
    optPrice?: number,
    _pvDividend?: number,
    gamma?: number,
    vega?: number,
    theta?: number
  ): void => {
    const info = reqIds.get(reqId)
    if (!info) return
    const data = greeksMap.get(`${info.strike}_${info.right}`)
    if (!data) return

    tickDataReceived++
    const normalizedField = field >= 53 && field <= 56 ? field - 43 : field

    if (
      normalizedField === 13 ||
      normalizedField === 10 ||
      normalizedField === 11 ||
      normalizedField === 12
    ) {
      const isModel = normalizedField === 13
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
      if (optPrice !== undefined && isFinite(optPrice) && optPrice > 0) {
        if (isModel || data.modelPrice === 0) data.modelPrice = optPrice
      }
    }
  }

  const onError = (err: Error, code: number, id: number): void => {
    if (!reqIds.has(id)) return
    errorReqIds.add(id)
    if (errorReqIds.size <= 3) {
      const info = reqIds.get(id)
      console.log(
        `[IB] Option data error for ${info?.strike} ${info?.right}: code=${code}, msg=${err.message}`
      )
    }
  }

  // Track as pending (not yet active — will register after initial data settles)
  pendingSubscriptions.add(cacheKey)
  const subscription: StreamingSubscription = {
    symbol,
    expiry,
    reqIds,
    greeksMap,
    errorReqIds,
    listeners: { onTickPrice, onTickOptionComputation, onError }
  }
  // Note: NOT registering in activeSubscriptions yet — will do so after initial data arrives

  // Attach persistent listeners
  api.on(EventName.tickPrice, onTickPrice)
  api.on(EventName.tickOptionComputation, onTickOptionComputation)
  api.on(EventName.error, onError)

  // Subscribe to streaming market data (NOT snapshot)
  let requestIndex = 0
  const allReqEntries = Array.from(reqIds.entries())

  function sendNextBatch(): void {
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
      if (tradingClass) contract.tradingClass = tradingClass

      if (i === 0) {
        console.log('[IB] First option contract:', JSON.stringify(contract))
      }

      // snapshot=false for streaming
      api!.reqMktData(reqId, contract, '', false, false)
    }

    requestIndex = end
    if (requestIndex < allReqEntries.length) {
      setTimeout(sendNextBatch, 20)
    }
  }

  console.log(
    `[IB] Streaming subscribe: ${strikes.length} strikes x 2 (C/P) = ${totalExpected} contracts, expiry ${expiry}`
  )

  sendNextBatch()

  // Reset market data type after subscription requests are sent
  setTimeout(() => {
    api.reqMarketDataType(2)
  }, 500)

  // Wait for initial data — resolve as soon as enough contracts have meaningful data
  return new Promise((resolve) => {
    let resolved = false

    const doResolve = (reason: string): void => {
      if (resolved) return
      resolved = true
      activeSubscriptions.set(cacheKey, subscription)
      pendingSubscriptions.delete(cacheKey)
      const results = getSubscriptionResults(subscription)
      const withData = results.filter((r) => r.bid > 0 || r.ask > 0 || r.delta !== 0).length
      console.log(
        `[IB] Streaming ${reason}: ${withData}/${results.length} have data, ${errorReqIds.size} errors`
      )
      setGreeksCache(cacheKey, results)
      resolve(results)
    }

    const checkReady = (): void => {
      if (resolved) return
      // Count contracts with meaningful data
      let withData = 0
      for (const data of greeksMap.values()) {
        if ((data.bid ?? 0) > 0 || (data.ask ?? 0) > 0 || (data.delta ?? 0) !== 0) {
          withData++
        }
      }
      const total = greeksMap.size
      const coverage = total > 0 ? withData / total : 0

      if (coverage >= 0.3 || withData >= 4) {
        doResolve(`ready (${(coverage * 100).toFixed(0)}% coverage)`)
      } else if (tickDataReceived > 0) {
        // Some ticks arrived but not enough data yet — check again soon
        setTimeout(checkReady, 200)
      } else {
        // No ticks yet — wait a bit longer
        setTimeout(checkReady, 300)
      }
    }

    setTimeout(checkReady, 300)

    // Hard timeout safety net — resolve with whatever we have
    setTimeout(() => {
      doResolve('hard timeout')
    }, 3000)
  })
}
