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

const POLL_INTERVAL = 1000

export function useAccountStore(connected: boolean, port: number): AccountStore {
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

  // Clear old data and reload aliases when port changes
  useEffect(() => {
    setAccounts([])
    setPositions([])
    setQuotes({})
    setOptionQuotes({})
    setOpenOrders([])
    setExecutions([])
    aliasRef.current = {}
    window.ibApi.getCachedAliases(port).then((cached) => {
      if (Object.keys(cached).length > 0) {
        aliasRef.current = cached
      }
    }).catch(() => { /* ignore */ })
  }, [port])

  const fetchData = useCallback(async () => {
    if (!connected) return
    // Skip if a previous fetch is still in progress
    if (fetchingRef.current) return
    fetchingRef.current = true

    setLoading(true)
    try {
      const [accountData, positionData, orderData, execData] = await Promise.all([
        window.ibApi.getAccountSummary(),
        window.ibApi.getPositions(),
        window.ibApi.getOpenOrders().catch(() => [] as OpenOrderData[]),
        window.ibApi.getExecutions().catch(() => [] as ExecutionDataItem[])
      ])

      // Apply known aliases immediately (from cache or previous fetch)
      const accountIds = accountData.map((a: AccountData) => a.accountId)
      const withAliases = accountData.map((a: AccountData) => ({
        ...a,
        alias: aliasRef.current[a.accountId] || a.alias
      }))
      // Merge accounts so partial responses don't remove existing cards
      setAccounts((prev) => {
        const merged = new Map(prev.map((a) => [a.accountId, a]))
        for (const a of withAliases) merged.set(a.accountId, a)
        return Array.from(merged.values())
      })
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
      setLoading(false)

      // Always fetch fresh aliases in background
      // (server-side in-memory cache prevents redundant IB API calls)
      if (accountIds.length > 0) {
        window.ibApi
          .getAccountAliases(accountIds, port)
          .then((aliasMap) => {
            aliasRef.current = { ...aliasRef.current, ...aliasMap }
            setAccounts((prev) =>
              prev.map((a) => ({
                ...a,
                alias: aliasMap[a.accountId] || a.alias
              }))
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

      // Fetch option quotes in background (non-blocking)
      const optionPositions = positionData.filter((p: PositionData) => p.secType === 'OPT' && p.expiry && p.strike && p.right)
      // De-duplicate by contract key
      const seen = new Set<string>()
      const optionContracts: Array<{ symbol: string; expiry: string; strike: number; right: string }> = []
      for (const p of optionPositions) {
        const key = `${p.symbol}|${p.expiry}|${p.strike}|${p.right}`
        if (!seen.has(key)) {
          seen.add(key)
          optionContracts.push({ symbol: p.symbol, expiry: p.expiry!, strike: p.strike!, right: p.right! })
        }
      }
      if (optionContracts.length > 0) {
        window.ibApi
          .getOptionQuotes(optionContracts)
          .then((optQuoteData) => {
            setOptionQuotes((prev) => ({ ...prev, ...optQuoteData }))
          })
          .catch(() => { /* ignore option quote errors */ })
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
    }
  }, [connected, fetchData])

  return { accounts, positions, quotes, optionQuotes, openOrders, executions, loading, refresh: fetchData }
}
