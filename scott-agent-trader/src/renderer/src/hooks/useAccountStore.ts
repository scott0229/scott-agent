import { useState, useEffect, useCallback, useRef } from 'react'

export interface AccountData {
  accountId: string
  alias: string
  accountType: string
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

export interface OpenOrderData {
  orderId: number
  account: string
  symbol: string
  secType: string
  action: string
  quantity: number
  orderType: string
  limitPrice: number
  status: string
  expiry?: string
  strike?: number
  right?: string
  comboDescription?: string
  comboLegs?: Array<{ conId: number; ratio: number; action: string; exchange: string }>
}

export interface ExecutionDataItem {
  execId: string
  orderId: number
  account: string
  symbol: string
  secType: string
  side: string
  quantity: number
  price: number
  avgPrice: number
  time: string
  expiry?: string
  strike?: number
  right?: string
  comboDescription?: string
}

interface AccountStore {
  accounts: AccountData[]
  positions: PositionData[]
  quotes: Record<string, number>
  optionQuotes: Record<string, number>
  openOrders: OpenOrderData[]
  executions: ExecutionDataItem[]
  loading: boolean
  refresh: () => void
}

const POLL_INTERVAL = 2000

export function useAccountStore(
  connected: boolean,
  port: number,
  onAliasUpdate?: (aliases: Record<string, string>) => void
): AccountStore {
  const [accounts, setAccounts] = useState<AccountData[]>([])
  const [positions, setPositions] = useState<PositionData[]>([])
  const [quotes, setQuotes] = useState<Record<string, number>>({})
  const [optionQuotes, setOptionQuotes] = useState<Record<string, number>>({})
  const [openOrders, setOpenOrders] = useState<OpenOrderData[]>([])
  const [executions, setExecutions] = useState<ExecutionDataItem[]>([])
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const aliasRef = useRef<Record<string, string>>({})
  const fetchingRef = useRef(false)
  const hasDataRef = useRef(false)
  const quoteCleanupRef = useRef<(() => void) | null>(null)

  // Clear old data and reload aliases when port changes
  useEffect(() => {
    setAccounts([])
    setPositions([])
    setQuotes({})
    setOptionQuotes({})
    setOpenOrders([])
    setExecutions([])
    aliasRef.current = {}
    hasDataRef.current = false
    window.ibApi
      .getCachedAliases(port)
      .then((cached) => {
        if (Object.keys(cached).length > 0) {
          aliasRef.current = cached
          onAliasUpdate?.(cached)
        }
      })
      .catch(() => {
        /* ignore */
      })
  }, [port])

  const fetchData = useCallback(async () => {
    if (!connected) return
    // Skip if a previous fetch is still in progress
    if (fetchingRef.current) return
    fetchingRef.current = true

    if (!hasDataRef.current) setLoading(true)
    try {
      const [accountData, positionData, orderData, execData] = await Promise.all([
        window.ibApi.getAccountSummary().catch(() => [] as AccountData[]),
        window.ibApi.getPositions().catch(() => [] as PositionData[]),
        window.ibApi.getOpenOrders().catch(() => [] as OpenOrderData[]),
        window.ibApi.getExecutions().catch(() => [] as ExecutionDataItem[])
      ])
      console.log(
        '[fetchData] accounts:',
        accountData.length,
        'positions:',
        positionData.length,
        'orders:',
        orderData.length,
        'execs:',
        execData.length
      )

      // Apply known aliases immediately (from cache or previous fetch)
      const accountIds = accountData.map((a: AccountData) => a.accountId)
      const withAliases = accountData.map((a: AccountData) => ({
        ...a,
        alias: aliasRef.current[a.accountId] || a.alias
      }))
      // Merge accounts so partial responses don't remove existing cards
      if (withAliases.length > 0) {
        setAccounts((prev) => {
          const merged = new Map(prev.map((a) => [a.accountId, a]))
          for (const a of withAliases) merged.set(a.accountId, a)
          return Array.from(merged.values())
        })
      }
      // Merge positions: keep previous entries for accounts not in this response
      if (positionData.length > 0) {
        setPositions((prev) => {
          const incomingAccounts = new Set(positionData.map((p: PositionData) => p.account))
          // Keep positions from accounts NOT in this response (they may have timed out)
          const kept = prev.filter((p) => !incomingAccounts.has(p.account))
          return [...kept, ...positionData]
        })
      }
      setOpenOrders(orderData)
      setExecutions(execData)
      hasDataRef.current = true
      setLoading(false)

      // Always fetch fresh aliases in background
      // (server-side in-memory cache prevents redundant IB API calls)
      if (accountIds.length > 0) {
        window.ibApi
          .getAccountAliases(accountIds, port)
          .then((aliasMap) => {
            aliasRef.current = { ...aliasRef.current, ...aliasMap }
            onAliasUpdate?.(aliasMap)
            setAccounts((prev) =>
              prev.map((a) => ({
                ...a,
                alias: aliasMap[a.accountId] || a.alias
              }))
            )
          })
          .catch(() => {
            /* ignore alias errors */
          })
      }

      // --- Streaming quote subscription ---
      // Build symbol lists from positions and subscribe to streaming data
      const stockSymbols = [
        ...new Set(
          positionData
            .filter((p: PositionData) => p.secType !== 'OPT')
            .map((p: PositionData) => p.symbol)
        )
      ]
      const optionPositions = positionData.filter(
        (p: PositionData) => p.secType === 'OPT' && p.expiry && p.strike && p.right
      )
      const seen = new Set<string>()
      const optionContracts: Array<{
        symbol: string
        expiry: string
        strike: number
        right: string
      }> = []
      for (const p of optionPositions) {
        const key = `${p.symbol}|${p.expiry}|${p.strike}|${p.right}`
        if (!seen.has(key)) {
          seen.add(key)
          optionContracts.push({
            symbol: p.symbol,
            expiry: p.expiry!,
            strike: p.strike!,
            right: p.right!
          })
        }
      }
      if (stockSymbols.length > 0 || optionContracts.length > 0) {
        // Clean up previous listener before re-subscribing
        if (quoteCleanupRef.current) {
          quoteCleanupRef.current()
          quoteCleanupRef.current = null
        }
        // Set up listener for streaming updates
        const removeListener = window.ibApi.onQuoteUpdate((data) => {
          if (data.quotes && Object.keys(data.quotes).length > 0) {
            setQuotes((prev) => {
              const merged = { ...prev }
              for (const [sym, price] of Object.entries(data.quotes)) {
                if ((price as number) > 0) merged[sym] = price as number
              }
              return merged
            })
          }
          if (data.optionQuotes && Object.keys(data.optionQuotes).length > 0) {
            setOptionQuotes((prev) => {
              const merged = { ...prev }
              for (const [key, price] of Object.entries(data.optionQuotes)) {
                if ((price as number) > 0) merged[key] = price as number
              }
              return merged
            })
          }
        })
        quoteCleanupRef.current = removeListener

        // Subscribe (this also returns an initial snapshot)
        window.ibApi
          .subscribeQuotes(stockSymbols, optionContracts)
          .then((initial) => {
            if (initial.quotes && Object.keys(initial.quotes).length > 0) {
              setQuotes((prev) => {
                const merged = { ...prev }
                for (const [sym, price] of Object.entries(initial.quotes)) {
                  if ((price as number) > 0) merged[sym] = price as number
                }
                return merged
              })
            }
            if (initial.optionQuotes && Object.keys(initial.optionQuotes).length > 0) {
              setOptionQuotes((prev) => {
                const merged = { ...prev }
                for (const [key, price] of Object.entries(initial.optionQuotes)) {
                  if ((price as number) > 0) merged[key] = price as number
                }
                return merged
              })
            }
          })
          .catch(() => {
            /* ignore subscribe errors */
          })
      }
    } catch (err: unknown) {
      console.error('Failed to fetch account data:', err)
      setLoading(false)
    } finally {
      fetchingRef.current = false
    }
  }, [connected, port])

  // Start/stop polling based on connection
  useEffect(() => {
    if (connected) {
      fetchData()
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL)
    } else {
      hasDataRef.current = false
      fetchingRef.current = false
      setAccounts([])
      setPositions([])
      setQuotes({})
      setOptionQuotes({})
      setOpenOrders([])
      setExecutions([])
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      // Clean up streaming subscription
      if (quoteCleanupRef.current) {
        quoteCleanupRef.current()
        quoteCleanupRef.current = null
      }
      window.ibApi.unsubscribeQuotes().catch(() => {})
    }
  }, [connected, fetchData])

  return {
    accounts,
    positions,
    quotes,
    optionQuotes,
    openOrders,
    executions,
    loading,
    refresh: fetchData
  }
}
