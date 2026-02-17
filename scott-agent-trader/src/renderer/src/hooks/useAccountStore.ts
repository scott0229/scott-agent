import { useState, useEffect, useCallback, useRef } from 'react'

export interface AccountData {
  accountId: string
  alias: string
  netLiquidation: number
  availableFunds: number
  totalCashValue: number
  grossPositionValue: number
  currency: string
}

export interface PositionData {
  account: string
  symbol: string
  secType: string
  quantity: number
  avgCost: number
  expiry?: string
  strike?: number
  right?: string
}

interface AccountStore {
  accounts: AccountData[]
  positions: PositionData[]
  quotes: Record<string, number>
  loading: boolean
  refresh: () => void
}

const POLL_INTERVAL = 5000

export function useAccountStore(connected: boolean): AccountStore {
  const [accounts, setAccounts] = useState<AccountData[]>([])
  const [positions, setPositions] = useState<PositionData[]>([])
  const [quotes, setQuotes] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const aliasRef = useRef<Record<string, string>>({})

  // Load cached aliases on mount (instant, before any IB connection)
  useEffect(() => {
    window.ibApi.getCachedAliases().then((cached) => {
      if (Object.keys(cached).length > 0) {
        aliasRef.current = cached
      }
    }).catch(() => { /* ignore */ })
  }, [])

  const fetchData = useCallback(async () => {
    if (!connected) return

    setLoading(true)
    try {
      const [accountData, positionData] = await Promise.all([
        window.ibApi.getAccountSummary(),
        window.ibApi.getPositions()
      ])

      // Apply known aliases immediately (from cache or previous fetch)
      const accountIds = accountData.map((a: AccountData) => a.accountId)
      const withAliases = accountData.map((a: AccountData) => ({
        ...a,
        alias: aliasRef.current[a.accountId] || a.alias
      }))
      setAccounts(withAliases)
      setPositions(positionData)
      setLoading(false)

      // Always fetch fresh aliases in background
      // (server-side in-memory cache prevents redundant IB API calls)
      if (accountIds.length > 0) {
        window.ibApi
          .getAccountAliases(accountIds)
          .then((aliasMap) => {
            aliasRef.current = { ...aliasRef.current, ...aliasMap }
            setAccounts((prev) =>
              prev.map((a) => ({ ...a, alias: aliasMap[a.accountId] || a.alias }))
            )
          })
          .catch(() => { /* ignore alias errors */ })
      }

      // Fetch last prices in background (non-blocking)
      const stockSymbols = [
        ...new Set(
          positionData
            .filter((p: PositionData) => p.secType !== 'OPT')
            .map((p: PositionData) => p.symbol)
        )
      ]
      if (stockSymbols.length > 0) {
        window.ibApi
          .getQuotes(stockSymbols)
          .then((quoteData) => {
            setQuotes(quoteData)
          })
          .catch(() => { /* ignore quote errors */ })
      }
    } catch (err: unknown) {
      console.error('Failed to fetch account data:', err)
      setLoading(false)
    }
  }, [connected])

  // Start/stop polling based on connection
  useEffect(() => {
    if (connected) {
      fetchData()
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL)
    } else {
      setAccounts([])
      setPositions([])
      setQuotes({})
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [connected, fetchData])

  return { accounts, positions, quotes, loading, refresh: fetchData }
}
