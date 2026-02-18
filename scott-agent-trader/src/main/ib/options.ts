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

/**
 * Request the option chain parameters (available expirations and strikes)
 * for the given underlying symbol.
 */
export async function requestOptionChain(symbol: string): Promise<OptionChainParams[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  // First, get the conId for the underlying stock
  const conId = await getUnderlyingConId(symbol)

  return new Promise((resolve, reject) => {
    const reqId = getNextReqId()
    const results: OptionChainParams[] = []
    const timeout = setTimeout(() => {
      reject(new Error('Option chain request timed out'))
    }, 15000)

    api.on(
      EventName.securityDefinitionOptionParameter,
      (
        id: number,
        exchange: string,
        underlyingConId: number,
        tradingClass: string,
        multiplier: string,
        expirations: string[],
        strikes: number[]
      ) => {
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
    )

    api.on(EventName.securityDefinitionOptionParameterEnd, (id: number) => {
      if (id !== reqId) return
      clearTimeout(timeout)
      resolve(results)
    })

    api.reqSecDefOptParams(reqId, symbol, '', 'STK', conId)
    console.log(`[IB] Requesting option chain for ${symbol} (conId: ${conId}, reqId: ${reqId})`)
  })
}

/**
 * Get the contract ID for an underlying stock symbol.
 */
async function getUnderlyingConId(symbol: string): Promise<number> {
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

    api.on(EventName.contractDetails, (id: number, details: any) => {
      if (id !== reqId) return
      clearTimeout(timeout)
      resolve(details.contract.conId)
    })

    api.on(EventName.error, (err: Error, _code: number, id: number) => {
      if (id !== reqId) return
      clearTimeout(timeout)
      reject(new Error(`Failed to get contract details for ${symbol}: ${err.message}`))
    })

    api.reqContractDetails(reqId, contract)
  })
}

/**
 * Request market data (bid/ask/greeks) for a batch of option contracts.
 * Returns a map of "strike_right" -> OptionGreek
 */
export async function requestOptionGreeks(
  symbol: string,
  expiry: string,
  strikes: number[],
  exchange: string = 'SMART'
): Promise<OptionGreek[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  console.log(`[IB] requestOptionGreeks called: symbol=${symbol}, expiry=${expiry}, strikes=${strikes.length}, exchange=${exchange}`)

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
        console.log(`[IB] Hard timeout fired. tickDataReceived=${tickDataReceived}, errors=${errorReqIds.size}, completed=${completedCount}/${totalExpected}`)
        finish()
      }
    }, 8000)

    // "Settle" timer: resolve early once data stops flowing for 1.5s
    function resetSettleTimer(): void {
      if (resolved) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        if (!resolved) {
          console.log(`[IB] Settle timer fired, tickDataReceived=${tickDataReceived}, completed=${completedCount}/${totalExpected}`)
          finish()
        }
      }, 1500)
    }

    function finish(): void {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      if (settleTimer) clearTimeout(settleTimer)
      cleanup()
      buildResults()
      console.log(`[IB] Option greeks finished: ${results.filter(r => r.bid > 0 || r.ask > 0 || r.delta !== 0).length}/${results.length} have data`)
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
        console.log(
          `[IB] Option tick: ${info.strike}${info.right} type=${tickType} value=${value}`
        )
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
        console.log(`[IB] Option data error for ${info?.strike} ${info?.right}: code=${code}, msg=${err.message}`)
      }
      // Count errors as completed to avoid hanging
      completedCount++
      if (completedCount >= totalExpected) {
        finish()
      }
    }

    function cleanup(): void {
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
        console.log(`[IB] DEBUG tickPrice: reqId=${rId}, type=${tt}, value=${val}, isOurs=${reqIds.has(rId)}`)
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
      const batchSize = 10
      const end = Math.min(requestIndex + batchSize, allReqEntries.length)

      for (let i = requestIndex; i < end; i++) {
        const [reqId, info] = allReqEntries[i]
        const contract = new Option(
          symbol,
          expiry,
          info.strike,
          info.right === 'C' ? OptionType.Call : OptionType.Put,
          exchange,
          'USD'
        )

        // Log first contract for debugging
        if (i === 0) {
          console.log('[IB] First option contract:', JSON.stringify(contract))
        }

        api!.reqMktData(reqId, contract, '', false, false)
      }

      requestIndex = end
      if (requestIndex < allReqEntries.length) {
        // Schedule next batch with a small delay
        setTimeout(sendNextBatch, 50)
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
