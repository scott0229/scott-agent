import { Contract, SecType, EventName, OptionType } from '@stoqey/ib'
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

let reqIdCounter = 10000

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
    let completedCount = 0
    const totalExpected = reqIds.size

    const timeout = setTimeout(() => {
      // Return whatever we have after timeout
      cleanup()
      buildResults()
      resolve(results)
    }, 10000)

    // tickPrice: bid(1), ask(2), last(4)
    const onTickPrice = (reqId: number, tickType: number, value: number): void => {
      const info = reqIds.get(reqId)
      if (!info) return
      const key = `${info.strike}_${info.right}`
      const data = greeksMap.get(key)
      if (!data) return

      if (tickType === 1) data.bid = value
      else if (tickType === 2) data.ask = value
      else if (tickType === 4) data.last = value
    }

    // tickOptionComputation: model delta/gamma/theta/vega/iv
    // Signature: (reqId, field, impliedVolatility?, delta?, optPrice?, pvDividend?, gamma?, vega?, theta?, undPrice?)
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

      // field 13 = model option computation
      if (field === 13) {
        if (impliedVol !== undefined && isFinite(impliedVol) && impliedVol > 0)
          data.impliedVol = impliedVol
        if (delta !== undefined && isFinite(delta)) data.delta = delta
        if (gamma !== undefined && isFinite(gamma)) data.gamma = gamma
        if (vega !== undefined && isFinite(vega)) data.vega = vega
        if (theta !== undefined && isFinite(theta)) data.theta = theta
      }
    }

    const onTickSnapshotEnd = (reqId: number): void => {
      if (!reqIds.has(reqId)) return
      completedCount++
      if (completedCount >= totalExpected) {
        clearTimeout(timeout)
        cleanup()
        buildResults()
        resolve(results)
      }
    }

    function cleanup(): void {
      api!.removeListener(EventName.tickPrice, onTickPrice)
      api!.removeListener(EventName.tickOptionComputation, onTickOptionComputation)
      api!.removeListener(EventName.tickSnapshotEnd, onTickSnapshotEnd)
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

    api.on(EventName.tickPrice, onTickPrice)
    api.on(EventName.tickOptionComputation, onTickOptionComputation)
    api.on(EventName.tickSnapshotEnd, onTickSnapshotEnd)

    // Request snapshot market data for each option contract
    for (const [reqId, info] of reqIds) {
      const contract: Contract = {
        symbol,
        secType: SecType.OPT,
        exchange,
        currency: 'USD',
        lastTradeDateOrContractMonth: expiry,
        strike: info.strike,
        right: info.right === 'C' ? OptionType.Call : OptionType.Put,
        multiplier: 100
      }

      // Request snapshot (true = snapshot mode)
      api.reqMktData(reqId, contract, '', true, false)
    }

    console.log(
      `[IB] Requesting greeks for ${strikes.length} strikes x 2 (C/P) = ${totalExpected} contracts`
    )
  })
}
