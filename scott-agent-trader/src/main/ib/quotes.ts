import { Contract, EventName, SecType } from '@stoqey/ib'
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
