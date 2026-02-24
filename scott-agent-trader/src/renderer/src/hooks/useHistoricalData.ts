import { useState, useCallback, useRef } from 'react'

export interface BarData {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

interface HistoricalDataStore {
  data: BarData[]
  loading: boolean
  error: string | null
  fetchData: (symbol: string, duration?: string, barSize?: string) => Promise<void>
}

export function useHistoricalData(): HistoricalDataStore {
  const [data, setData] = useState<BarData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)

  const fetchData = useCallback(async (symbol: string, duration = '1 Y', barSize = '1 day') => {
    if (fetchingRef.current) return
    fetchingRef.current = true

    setLoading(true)
    setError(null)

    try {
      const response = await window.ibApi.getHistoricalData({
        symbol,
        durationString: duration,
        barSizeSetting: barSize,
        useRTH: 1, // Regular trading hours
        whatToShow: 'TRADES'
      })

      setData(response)
    } catch (err: any) {
      console.error('Failed to fetch historical data:', err)
      setError(err.message || 'Failed to fetch data')
      setData([])
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [])

  return { data, loading, error, fetchData }
}
