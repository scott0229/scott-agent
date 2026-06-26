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
  permId: number
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
  filled?: number
  avgFillPrice?: number
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
  commission?: number
}

interface AccountStore {
  accounts: AccountData[]
  positions: PositionData[]
  quotes: Record<string, number>
  stockCloses: Record<string, number>
  optionQuotes: Record<string, number>
  openOrders: OpenOrderData[]
  orderQuotes: Record<string, { bid: number; ask: number }>
  executions: ExecutionDataItem[]
  loading: boolean
  refresh: () => void
}

const POLL_INTERVAL = 2000
const HISTORY_POLL_INTERVAL = 10000

// Merge incoming order bid/ask into the store, keeping the last good value per
// side. The main process emits NaN for a leg whose quote hasn't arrived yet;
// blindly merging that would flicker a previously-good 買價/賣價 to "-". Combo
// (roll) order quotes can be negative (net debit), so a value is "good" when it
// is finite — NOT when it's > 0.
type OrderBidAsk = { bid: number; ask: number }
function mergeOrderQuotes(
  prev: Record<string, OrderBidAsk>,
  incoming: Record<string, OrderBidAsk>
): Record<string, OrderBidAsk> {
  const merged = { ...prev }
  for (const [key, q] of Object.entries(incoming)) {
    const prevQ = merged[key]
    const bid = Number.isFinite(q?.bid) ? q.bid : prevQ?.bid
    const ask = Number.isFinite(q?.ask) ? q.ask : prevQ?.ask
    // Don't create an entry until at least one side has ever had real data.
    if (Number.isFinite(bid) || Number.isFinite(ask)) {
      merged[key] = {
        bid: Number.isFinite(bid) ? (bid as number) : NaN,
        ask: Number.isFinite(ask) ? (ask as number) : NaN
      }
    }
  }
  return merged
}

export function useAccountStore(
  connected: boolean,
  port: number,
  onAliasUpdate?: (aliases: Record<string, string>) => void
): AccountStore {
  const [accounts, setAccounts] = useState<AccountData[]>([])
  const [positions, setPositions] = useState<PositionData[]>([])
  const [quotes, setQuotes] = useState<Record<string, number>>({})
  // Prior-session close per stock symbol → day-change % in the header pills.
  const [stockCloses, setStockCloses] = useState<Record<string, number>>({})
  const [optionQuotes, setOptionQuotes] = useState<Record<string, number>>({})
  const [openOrders, setOpenOrders] = useState<OpenOrderData[]>([])
  const [orderQuotes, setOrderQuotes] = useState<Record<string, { bid: number; ask: number }>>({})
  const [executions, setExecutions] = useState<ExecutionDataItem[]>([])
  const [loading, setLoading] = useState(false)
  // Latest open orders, mirrored to a ref so the (positions-driven) quote
  // subscription can include the working orders' contracts for live bid/ask.
  const openOrdersRef = useRef<OpenOrderData[]>([])

  const intervalAssetsRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const intervalHistoryRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const aliasRef = useRef<Record<string, string>>({})
  const fetchingAssetsRef = useRef(false)
  const fetchingHistoryRef = useRef(false)
  const hasDataRef = useRef(false)
  const quoteCleanupRef = useRef<(() => void) | null>(null)
  const lastOrderUpdateRef = useRef<Record<number, number>>({})
  // Consecutive-miss counter (keyed by position) for the snapshot merge below.
  // A leg that drops out of a single (possibly partial) IB snapshot is kept for
  // one grace cycle so it doesn't blink out of the card; it's only removed once
  // it's been absent from two snapshots in a row (a genuinely-closed position).
  const posMissRef = useRef<Map<string, number>>(new Map())
  // Signature of the currently-subscribed contract set. We only re-subscribe
  // when it changes — re-subscribing every poll tears down combo market data
  // before IB finishes computing its net bid/ask (which takes a few seconds).
  const lastQuoteSigRef = useRef<string>('')

  // Mirror open orders into a ref for the quote subscription.
  useEffect(() => {
    openOrdersRef.current = openOrders
  }, [openOrders])

  useEffect(() => {
    setAccounts([])
    setPositions([])
    setQuotes({})
    setOptionQuotes({})
    setOpenOrders([])
    setOrderQuotes({})
    setExecutions([])
    aliasRef.current = {}
    hasDataRef.current = false
    lastQuoteSigRef.current = ''
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
          const keyOf = (p: PositionData): string =>
            `${p.account}|${p.symbol}|${p.secType}|${p.expiry || ''}|${p.strike || ''}|${p.right || ''}`
          const incomingAccounts = new Set(positionData.map((p: PositionData) => p.account))
          const incomingKeys = new Set(positionData.map(keyOf))
          const misses = posMissRef.current

          // Positions for accounts NOT in this snapshot are untouched.
          const result = prev.filter((p) => !incomingAccounts.has(p.account))

          // Positions for accounts that ARE in this snapshot but missing a leg:
          // keep that leg for one grace cycle (it may have transiently dropped
          // out of a partial IB snapshot). Only drop it after two misses in a
          // row, so a genuinely-closed position still clears promptly.
          for (const p of prev) {
            if (!incomingAccounts.has(p.account)) continue
            const k = keyOf(p)
            if (incomingKeys.has(k)) continue // refreshed from incoming below
            const n = (misses.get(k) || 0) + 1
            if (n < 2) {
              misses.set(k, n)
              result.push(p)
            } else {
              misses.delete(k)
            }
          }

          // Everything present in this snapshot resets its miss counter.
          for (const p of positionData) misses.delete(keyOf(p))

          return [...result, ...positionData]
        })
      }
      hasDataRef.current = true
      setLoading(false)

      if (accountIds.length > 0) {
        // Try once, then retry the still-missing accounts up to 2 more times.
        // requestSingleAccountAlias in main has a 5s timeout per account and
        // IB sometimes drops AccountOrGroup when 10+ accounts request in
        // parallel, leaving cards showing the raw UXXXXX accountId.
        const fetchAndApply = async (ids: string[]): Promise<string[]> => {
          let stillMissing: string[] = []
          try {
            const aliasMap = await window.ibApi.getAccountAliases(ids, port)
            aliasRef.current = { ...aliasRef.current, ...aliasMap }
            onAliasUpdate?.(aliasMap)
            setAccounts((prev) =>
              prev.map((a) => ({
                ...a,
                alias: aliasMap[a.accountId] || a.alias
              }))
            )
            stillMissing = ids.filter((id) => !aliasMap[id])
          } catch {
            stillMissing = ids
          }
          return stillMissing
        }
        ;(async () => {
          let pending = accountIds
          for (let attempt = 0; attempt < 3 && pending.length > 0; attempt++) {
            if (attempt > 0) {
              await new Promise((r) => setTimeout(r, 3000))
            }
            pending = await fetchAndApply(pending)
          }
        })()
      }

      // Subscribe to the underlying stock quote for EVERY symbol that appears
      // in any position — including option-only positions. That way the
      // trader card and the report-note ticker pill have access to the
      // underlying price even when there's no direct stock holding (e.g.,
      // accounts that only sell TQQQ puts still see TQQQ's spot price).
      const stockSymbols = [
        ...new Set(positionData.map((p: PositionData) => p.symbol))
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
      // Build live-quote requests for each WORKING order (combo / single) so
      // the orders card can show net bid/ask. Keyed by `${account}|${orderId}`.
      const orderReqs = openOrdersRef.current
        .filter((o) => o.status !== 'Cancelled' && o.status !== 'Filled')
        .map((o) => ({
          key: `${o.account}|${o.permId}`,
          symbol: o.symbol,
          secType: o.secType,
          expiry: o.expiry,
          strike: o.strike,
          right: o.right,
          comboLegs: o.comboLegs
        }))

      // Signature of the contract set — re-subscribe only when this changes.
      const quoteSig = [
        stockSymbols.slice().sort().join(','),
        optionContracts
          .map((c) => `${c.symbol}|${c.expiry}|${c.strike}|${c.right}`)
          .sort()
          .join(','),
        orderReqs
          .map((o) => o.key)
          .sort()
          .join(',')
      ].join('||')

      if (
        (stockSymbols.length > 0 ||
          optionContracts.length > 0 ||
          orderReqs.length > 0) &&
        (quoteSig !== lastQuoteSigRef.current || !quoteCleanupRef.current)
      ) {
        lastQuoteSigRef.current = quoteSig
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
          if (data.closes && Object.keys(data.closes).length > 0) {
            setStockCloses((prev) => {
              const merged = { ...prev }
              for (const [sym, c] of Object.entries(data.closes)) {
                if ((c as number) > 0) merged[sym] = c as number
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
          if (data.orderQuotes && Object.keys(data.orderQuotes).length > 0) {
            setOrderQuotes((prev) => mergeOrderQuotes(prev, data.orderQuotes))
          }
        })
        quoteCleanupRef.current = removeListener

        window.ibApi
          .subscribeQuotes(stockSymbols, optionContracts, orderReqs)
          .then((initial) => {
            if (initial.orderQuotes && Object.keys(initial.orderQuotes).length > 0) {
              setOrderQuotes((prev) => mergeOrderQuotes(prev, initial.orderQuotes))
            }
            if (initial.quotes && Object.keys(initial.quotes).length > 0) {
              setQuotes((prev) => {
                const merged = { ...prev }
                for (const [sym, price] of Object.entries(initial.quotes)) {
                  if ((price as number) > 0) merged[sym] = price as number
                }
                return merged
              })
            }
            if (initial.closes && Object.keys(initial.closes).length > 0) {
              setStockCloses((prev) => {
                const merged = { ...prev }
                for (const [sym, c] of Object.entries(initial.closes)) {
                  if ((c as number) > 0) merged[sym] = c as number
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
        // Key by permId — orderId is NOT unique across clients (TWS-placed
        // orders can collide), which would collapse distinct orders.
        const mergedMap = new Map<number, OpenOrderData>()

        for (const o of orderData) {
          mergedMap.set(o.permId, o)
        }

        for (const po of prev) {
          const lastUpdate = lastOrderUpdateRef.current[po.permId] || 0
          // Keep recently-updated orders (grace window) AND keep FILLED orders
          // for the whole session — reqOpenOrders drops filled orders, but the
          // user wants them to stay (showing 成交價 / 已成交).
          if (now - lastUpdate < 10000 || po.status === 'Filled') {
            mergedMap.set(po.permId, { ...mergedMap.get(po.permId), ...po })
          }
        }

        return Array.from(mergedMap.values()).sort((a, b) => b.permId - a.permId)
      })
      // Merge, don't replace. getExecutions() can come back empty (a slow/timed-
      // out reqExecutions on a multi-account FA login returns []). Replacing
      // would wipe live-streamed fills (onExecutionUpdate) — exactly what the
      // batch card's blue "今日完成" bar reads — so a roll's fill would flash on
      // then vanish on the next poll. Keep prior executions when empty; union by
      // execId otherwise.
      setExecutions((prev) => {
        if (execData.length === 0) return prev
        const map = new Map(prev.map((e) => [e.execId, e]))
        for (const e of execData) map.set(e.execId, e)
        return Array.from(map.values())
      })
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
      lastOrderUpdateRef.current[newOrder.permId] = Date.now()
      setOpenOrders((prev) => {
        const existingIdx = prev.findIndex((o) => o.permId === newOrder.permId)
        if (existingIdx >= 0) {
          const next = [...prev]
          next[existingIdx] = newOrder
          return next
        }
        return [newOrder, ...prev]
      })
    })

    // Setup streaming listener for Order Status. Capture fill progress
    // (filled qty + avg fill price, the combo NET for BAG orders) so a filled
    // order stays in the card showing its 成交價 instead of vanishing.
    const removeStatus = window.ibApi.onOrderStatus(
      (update: {
        orderId: number
        permId?: number
        status: string
        filled?: number
        avgFillPrice?: number
      }) => {
        console.log('[Streaming] received orderStatus:', update)
        const pid = update.permId ?? 0
        if (pid) lastOrderUpdateRef.current[pid] = Date.now()
        setOpenOrders((prev) => {
          const existingIdx = prev.findIndex((o) =>
            pid ? o.permId === pid : o.orderId === update.orderId
          )
          if (existingIdx >= 0) {
            const next = [...prev]
            next[existingIdx] = {
              ...next[existingIdx],
              status: update.status,
              ...(update.filled != null ? { filled: update.filled } : {}),
              ...(update.avgFillPrice != null ? { avgFillPrice: update.avgFillPrice } : {})
            }
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
      lastQuoteSigRef.current = ''
      window.ibApi.unsubscribeQuotes().catch(() => {})
    }
  }, [connected, fetchAssets, fetchHistory])

  const refresh = useCallback(() => {
    fetchAssets()
    fetchHistory()
  }, [fetchAssets, fetchHistory])

  return {
    stockCloses,
    accounts,
    positions,
    quotes,
    optionQuotes,
    openOrders,
    orderQuotes,
    executions,
    loading,
    refresh
  }
}
