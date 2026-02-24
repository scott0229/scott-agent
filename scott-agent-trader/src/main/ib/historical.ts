import { Contract, EventName, SecType, BarSizeSetting } from '@stoqey/ib'
import { getIBApi } from './connection'

let reqIdCounter = 90000

function getNextReqId(): number {
  return reqIdCounter++
}

export interface HistoricalDataRequest {
  symbol: string
  secType?: string // Default 'STK'
  endDateTime?: string // e.g., '20231001 23:59:59', default '' (until now)
  durationString?: string // e.g., '1 M', '1 Y', default '1 Y'
  barSizeSetting?: string // e.g., '1 day', '1 hour', default '1 day'
  whatToShow?: string // 'TRADES', 'MIDPOINT', etc., default 'TRADES'
  useRTH?: number // 1 for Regular Trading Hours only, 0 for all. Default 1
}

export interface BarData {
  time: string // string 'YYYY-MM-DD' or timestamp
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export async function getHistoricalData(req: HistoricalDataRequest): Promise<BarData[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  const reqId = getNextReqId()
  const bars: BarData[] = []

  const contract: Contract = {
    symbol: req.symbol.toUpperCase(),
    secType: (req.secType as SecType) || SecType.STK,
    exchange: 'SMART',
    currency: 'USD'
  }

  const endDateTime = req.endDateTime || ''
  const durationString = req.durationString || '1 Y'
  const barSizeSetting = req.barSizeSetting || '1 day' // Note: IB uses exact strings like '1 day', '1 min', etc.
  const whatToShow = req.whatToShow || 'TRADES'
  const useRTH = req.useRTH !== undefined ? req.useRTH : 1
  const formatDate = 1 // 1 for yyyyMMdd HH:mm:ss, 2 for system time format in seconds

  return new Promise((resolve, reject) => {
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.error(`[IB] Historical data timeout for ${req.symbol}`)
        reject(new Error(`Historical data request timeout for ${req.symbol}`))
      }
    }, 10000)

    const onHistoricalData = (
      id: number,
      time: string,
      open: number,
      high: number,
      low: number,
      close: number,
      volume: number,
      _count: number,
      _WAP: number,
      _hasGaps: boolean
    ) => {
      if (id !== reqId || resolved) return

      if (time.startsWith('finished')) {
        resolved = true
        clearTimeout(timeout)
        cleanup()
        console.log(`[IB] Historical data finished for ${req.symbol}, loaded ${bars.length} bars`)
        resolve(bars)
        return
      }

      // time format from IB is usually 'YYYYMMDD' for daily bars, or 'YYYYMMDD HH:mm:ss' for intraday
      let formattedTime = time
      if (time.length === 8) {
        // YYYYMMDD -> YYYY-MM-DD
        formattedTime = `${time.substring(0, 4)}-${time.substring(4, 6)}-${time.substring(6, 8)}`
      }

      bars.push({
        time: formattedTime,
        open,
        high,
        low,
        close,
        volume
      })
    }

    const onError = (error: Error, code: number, id: number) => {
      if (id === reqId && !resolved) {
        resolved = true
        clearTimeout(timeout)
        cleanup()
        console.error(
          `[IB] Historical data error for ${req.symbol}: ${error.message} (code: ${code})`
        )
        reject(error)
      }
    }

    function cleanup() {
      api!.off(EventName.historicalData, onHistoricalData as any)
      api!.off(EventName.error, onError)
    }

    api.on(EventName.historicalData, onHistoricalData as any)
    api.on(EventName.error, onError)

    console.log(`[IB] Requesting historical data for ${req.symbol} (reqId: ${reqId})`)

    // As any because the typed signature in stoqey/ib might differ slightly
    ;(api as any).reqHistoricalData(
      reqId,
      contract,
      endDateTime,
      durationString,
      barSizeSetting as BarSizeSetting,
      whatToShow,
      useRTH,
      formatDate,
      false // keepUpToDate
    )
  })
}
