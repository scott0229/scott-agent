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
const HISTORY_POLL_INTERVAL = 10000

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

  const intervalAssetsRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const intervalHistoryRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const aliasRef = useRef<Record<string, string>>({})
  const fetchingAssetsRef = useRef(false)
  const fetchingHistoryRef = useRef(false)
  const hasDataRef = useRef(false)
  const quoteCleanupRef = useRef<(() => void) | null>(null)
  const lastOrderUpdateRef = useRef<Record<number, number>>({})

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
      .catch(() => {})
  }, [port])

  const fetchAssets = useCallback(async () => {
    if (!connected) return
    if (fetchingAssetsRef.current) return
    fetchingAssetsRef.current = true

    if (!hasDataRef.current) setLoading(true)
    try {
      const [accountData, positionData] = await Promise.all([
        window.ibApi.getAccountSummary().catch(() => [] as AccountData[]),
        window.ibApi.getPositions().catch(() => [] as PositionData[])
      ])

      const accountIds = accountData.map((a: AccountData) => a.accountId)
      const withAliases = accountData.map((a: AccountData) => ({
        ...a,
        alias: aliasRef.current[a.accountId] || a.alias
      }))
      if (withAliases.length > 0) {
        setAccounts((prev) => {
          const merged = new Map(prev.map((a) => [a.accountId, a]))
          for (const a of withAliases) merged.set(a.accountId, a)
          return Array.from(merged.values())
        })
      }
      if (positionData.length > 0) {
        setPositions((prev) => {
          const incomingAccounts = new Set(positionData.map((p: PositionData) => p.account))
          const kept = prev.filter((p) => !incomingAccounts.has(p.account))
          return [...kept, ...positionData]
        })
      }
      hasDataRef.current = true
      setLoading(false)

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
          .catch(() => {})
      }

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
        if (quoteCleanupRef.current) {
          quoteCleanupRef.current()
          quoteCleanupRef.current = null
        }
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
          .catch(() => {})
      }
    } catch (err: unknown) {
      console.error('Failed to fetch account assets data:', err)
      setLoading(false)
    } finally {
      fetchingAssetsRef.current = false
    }
  }, [connected, port])

  const fetchHistory = useCallback(async () => {
    if (!connected) return
    if (fetchingHistoryRef.current) return
    fetchingHistoryRef.current = true
    try {
      const [orderData, execData] = await Promise.all([
        window.ibApi.getOpenOrders().catch(() => [] as OpenOrderData[]),
        window.ibApi.getExecutions().catch(() => [] as ExecutionDataItem[])
      ])
      // Use merging assignment to cleanly update array and intelligently preserve recent locally updated stream data
      setOpenOrders((prev) => {
        const now = Date.now()
        const mergedMap = new Map<number, OpenOrderData>()

        for (const o of orderData) {
          mergedMap.set(o.orderId, o)
        }

        for (const po of prev) {
          const lastUpdate = lastOrderUpdateRef.current[po.orderId] || 0
          if (now - lastUpdate < 10000) {
            mergedMap.set(po.orderId, { ...mergedMap.get(po.orderId), ...po })
          }
        }

        return Array.from(mergedMap.values()).sort((a, b) => b.orderId - a.orderId)
      })
      setExecutions(execData)
    } catch (err) {
      console.error('Failed to fetch history:', err)
    } finally {
      fetchingHistoryRef.current = false
    }
  }, [connected])

  useEffect(() => {
    if (!connected) return

    // Setup streaming listener for Open Orders
    const removeOrder = window.ibApi.onOpenOrderUpdate((newOrder: OpenOrderData) => {
      console.log('[Streaming] received openOrder:', newOrder)
      lastOrderUpdateRef.current[newOrder.orderId] = Date.now()
      setOpenOrders((prev) => {
        const existingIdx = prev.findIndex((o) => o.orderId === newOrder.orderId)
        if (existingIdx >= 0) {
          const next = [...prev]
          next[existingIdx] = newOrder
          return next
        }
        return [newOrder, ...prev]
      })
    })

    // Setup streaming listener for Order Status
    const removeStatus = window.ibApi.onOrderStatus(
      (update: { orderId: number; status: string }) => {
        console.log('[Streaming] received orderStatus:', update)
        lastOrderUpdateRef.current[update.orderId] = Date.now()
        setOpenOrders((prev) => {
          const existingIdx = prev.findIndex((o) => o.orderId === update.orderId)
          if (existingIdx >= 0) {
            const next = [...prev]
            next[existingIdx] = { ...next[existingIdx], status: update.status }
            return next
          }
          return prev
        })
      }
    )

    // Setup streaming listener for Executions
    const removeExec = window.ibApi.onExecutionUpdate((newExec: ExecutionDataItem) => {
      console.log('[Streaming] received execution:', newExec)
      setExecutions((prev) => {
        if (prev.some((e) => e.execId === newExec.execId)) return prev
        return [newExec, ...prev]
      })
    })

    return () => {
      removeOrder()
      removeStatus()
      removeExec()
    }
  }, [connected])

  useEffect(() => {
    if (connected) {
      fetchAssets()
      fetchHistory()
      intervalAssetsRef.current = setInterval(fetchAssets, POLL_INTERVAL)
      intervalHistoryRef.current = setInterval(fetchHistory, HISTORY_POLL_INTERVAL)
    } else {
      hasDataRef.current = false
      fetchingAssetsRef.current = false
      fetchingHistoryRef.current = false
      setAccounts([])
      setPositions([])
      setQuotes({})
      setOptionQuotes({})
      setOpenOrders([])
      setExecutions([])
    }

    return () => {
      if (intervalAssetsRef.current) {
        clearInterval(intervalAssetsRef.current)
        intervalAssetsRef.current = null
      }
      if (intervalHistoryRef.current) {
        clearInterval(intervalHistoryRef.current)
        intervalHistoryRef.current = null
      }
      if (quoteCleanupRef.current) {
        quoteCleanupRef.current()
        quoteCleanupRef.current = null
      }
      window.ibApi.unsubscribeQuotes().catch(() => {})
    }
  }, [connected, fetchAssets, fetchHistory])

  const refresh = useCallback(() => {
    fetchAssets()
    fetchHistory()
  }, [fetchAssets, fetchHistory])

  return {
    accounts,
    positions,
    quotes,
    optionQuotes,
    openOrders,
    executions,
    loading,
    refresh
  }
}
