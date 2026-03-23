import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

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

export function formatExpiry(expiry: string): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ]
  const year = expiry.substring(2, 4)
  const month = months[parseInt(expiry.substring(4, 6)) - 1]
  const day = parseInt(expiry.substring(6, 8), 10)
  return `${month}${day} '${year}`
}

export const formatPrice = (v: number): string => (v > 0 ? v.toFixed(2) : '-')
export const formatGreekValue = (v: number): string => {
  if (v === 0) return '-'
  return v.toFixed(3)
}

export function mergeGreek(old: OptionGreek, n: OptionGreek): OptionGreek {
  return {
    ...old,
    bid: n.bid > 0 ? n.bid : old.bid,
    ask: n.ask > 0 ? n.ask : old.ask,
    last: n.last > 0 ? n.last : old.last,
    delta: n.delta !== 0 ? n.delta : old.delta,
    gamma: n.gamma !== 0 ? n.gamma : old.gamma,
    theta: n.theta !== 0 ? n.theta : old.theta,
    vega: n.vega !== 0 ? n.vega : old.vega,
    impliedVol: n.impliedVol > 0 ? n.impliedVol : old.impliedVol
  }
}

interface UseOptionChainOptions {
  /** The underlying symbol to fetch chain for */
  symbol: string
  /** Whether the dialog is open */
  open: boolean
  /** Optional filter for expirations (e.g. roll dialog filters to >= maxCurrentExpiry) */
  expiryFilter?: (expiry: string) => boolean
  /** Whether to cancel greek subscriptions on cleanup (roll dialog does this) */
  cancelSubscriptionsOnCleanup?: boolean
}

export function useOptionChain({
  symbol,
  open,
  expiryFilter,
  cancelSubscriptionsOnCleanup = false
}: UseOptionChainOptions) {
  // ── Chain state ─────────────────────────────────────────────────────────
  const [chainParams, setChainParams] = useState<OptionChainParams[]>([])
  const [loadingChain, setLoadingChain] = useState(false)
  const [allGreeks, setAllGreeks] = useState<OptionGreek[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [stockPrice, setStockPrice] = useState<number | null>(null)
  const stockPriceSymbolRef = useRef('')

  // ── Filters ─────────────────────────────────────────────────────────────
  const [selectedExpirations, setSelectedExpirations] = useState<string[]>([])
  const [expiryDropdownOpen, setExpiryDropdownOpen] = useState(false)
  const [selectedStrikes, setSelectedStrikes] = useState<number[]>([])
  const [strikeDropdownOpen, setStrikeDropdownOpen] = useState(false)
  const [chainHidden, setChainHidden] = useState(false)

  const fetchedExpiriesRef = useRef<Set<string>>(new Set())
  const fetchedStrikesRef = useRef<Set<number>>(new Set())
  const strikeDropdownRef = useRef<HTMLDivElement>(null)
  const strikeScrolledRef = useRef(false)
  const lastStrikeCenterRef = useRef<number | null>(null)
  const userModifiedStrikesRef = useRef(false)

  // ── Fetch chain ─────────────────────────────────────────────────────────
  const fetchedSymbolRef = useRef('')

  const fetchChain = useCallback((sym: string) => {
    if (!sym) return
    const isNewSymbol = fetchedSymbolRef.current !== sym
    fetchedSymbolRef.current = sym
    setErrorMsg('')
    if (isNewSymbol) {
      setLoadingChain(true)
      setChainParams([])
      setAllGreeks([])
      setSelectedExpirations([])
      setSelectedStrikes([])
      fetchedExpiriesRef.current = new Set()
      fetchedStrikesRef.current = new Set()
      setStockPrice(null)
      lastStrikeCenterRef.current = null
      userModifiedStrikesRef.current = false
    }

    // Fetch cached stock price first (instant), then update with live quote
    stockPriceSymbolRef.current = sym
    window.ibApi
      .getCachedStockPrice(sym)
      .then((cached) => {
        if (stockPriceSymbolRef.current !== sym) return
        if (cached) setStockPrice(cached)
      })
      .catch(() => { })
    window.ibApi
      .getStockQuote(sym)
      .then((q) => {
        if (stockPriceSymbolRef.current !== sym) return
        const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
        if (price) setStockPrice(price)
      })
      .catch(() => { })

    window.ibApi
      .getOptionChain(sym)
      .then((params) => {
        setChainParams(params)
        if (params.length === 0) setErrorMsg('未找到期權鏈資料')
      })
      .catch((err: unknown) => {
        setErrorMsg(`查詢失敗: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoadingChain(false))
  }, [])

  // Reset when dialog closes or symbol changes
  const resetChain = useCallback(() => {
    setChainParams([])
    setAllGreeks([])
    setSelectedExpirations([])
    setSelectedStrikes([])
    fetchedExpiriesRef.current = new Set()
    fetchedStrikesRef.current = new Set()
    setStockPrice(null)
    lastStrikeCenterRef.current = null
    userModifiedStrikesRef.current = false
    setErrorMsg('')
    setLoadingChain(false)
  }, [])

  // ── Available expirations / strikes ──────────────────────────────────────
  const availableExpirations = useMemo(() => {
    const set = new Set<string>()
    chainParams.forEach((p) => p.expirations.forEach((e) => set.add(e)))
    const all = Array.from(set)
    const filtered = expiryFilter ? all.filter(expiryFilter) : all
    return filtered.sort()
  }, [chainParams, expiryFilter])

  // Detect if .5 strikes are "extra" by checking the most common spacing
  const hasExtraDecimals = useMemo(() => {
    const allStrikes = new Set<number>()
    chainParams.forEach((p) => p.strikes.forEach((s) => allStrikes.add(s)))
    const sorted = Array.from(allStrikes).sort((a, b) => a - b)
    if (sorted.length < 2) return false
    const diffs = new Map<number, number>()
    for (let i = 1; i < sorted.length; i++) {
      const d = Math.round((sorted[i] - sorted[i - 1]) * 100) / 100
      diffs.set(d, (diffs.get(d) || 0) + 1)
    }
    let modeVal = 0
    let modeCount = 0
    diffs.forEach((count, val) => {
      if (count > modeCount) {
        modeVal = val
        modeCount = count
      }
    })
    return modeVal >= 1.0
  }, [chainParams])

  const availableStrikes = useMemo(() => {
    const set = new Set<number>()
    chainParams.forEach((p) => p.strikes.forEach((s) => set.add(s)))
    return Array.from(set)
      .filter((s) => {
        if (hasExtraDecimals) return s % 1 === 0
        return (s * 2) % 1 === 0
      })
      .sort((a, b) => a - b)
  }, [chainParams, hasExtraDecimals])

  // ── Auto-select first expiration ──────────────────────────────────────
  useEffect(() => {
    if (availableExpirations.length > 0 && selectedExpirations.length === 0) {
      setSelectedExpirations(availableExpirations.slice(0, 1))
    }
  }, [availableExpirations])

  // ── Auto-select ±5 strikes around stock price ─────────────────────────
  useEffect(() => {
    if (availableStrikes.length === 0) return
    if (userModifiedStrikesRef.current) return

    const total = Math.min(10, availableStrikes.length)

    if (stockPrice !== null) {
      // Re-center around stock price
      const rounded = Math.round(stockPrice)
      if (lastStrikeCenterRef.current === rounded) return
      lastStrikeCenterRef.current = rounded
      const idx = availableStrikes.findIndex((s) => s >= stockPrice)
      const center = idx === -1 ? availableStrikes.length - 1 : idx
      let start = Math.max(0, center - Math.floor(total / 2))
      let end = start + total
      if (end > availableStrikes.length) {
        end = availableStrikes.length
        start = Math.max(0, end - total)
      }
      setSelectedStrikes(availableStrikes.slice(start, end))
    } else if (selectedStrikes.length === 0) {
      // Immediately show strikes from the middle (don't wait for stockPrice)
      const mid = Math.floor(availableStrikes.length / 2)
      const start = Math.max(0, mid - Math.floor(total / 2))
      const end = Math.min(availableStrikes.length, start + total)
      setSelectedStrikes(availableStrikes.slice(start, end))
    }
  }, [availableStrikes, stockPrice])

  const displayExpirations = useMemo(
    () => selectedExpirations.filter((e) => availableExpirations.includes(e)).sort(),
    [selectedExpirations, availableExpirations]
  )
  const displayStrikes = useMemo(
    () => selectedStrikes.filter((s) => availableStrikes.includes(s)).sort((a, b) => a - b),
    [selectedStrikes, availableStrikes]
  )

  const toggleExpiry = useCallback((exp: string) => {
    setSelectedExpirations([exp])
    setExpiryDropdownOpen(false)
  }, [])

  const toggleStrike = useCallback((strike: number) => {
    userModifiedStrikesRef.current = true
    setSelectedStrikes((prev) => {
      if (prev.includes(strike)) return prev.filter((s) => s !== strike)
      return [...prev, strike]
    })
  }, [])

  // ── Fetch greeks for new expiry/strike combinations ──────────────────
  useEffect(() => {
    if (displayStrikes.length === 0 || !symbol) return
    const newExpiries = displayExpirations.filter((e) => !fetchedExpiriesRef.current.has(e))
    const newStrikes = displayStrikes.filter((s) => !fetchedStrikesRef.current.has(s))
    const fetchPairs: { exp: string; strikes: number[] }[] = []

    if (newExpiries.length > 0) {
      newExpiries.forEach((exp) => {
        fetchPairs.push({ exp, strikes: displayStrikes })
        fetchedExpiriesRef.current.add(exp)
      })
    }
    if (newStrikes.length > 0) {
      const existingExpiries = displayExpirations.filter((e) => !newExpiries.includes(e))
      existingExpiries.forEach((exp) => fetchPairs.push({ exp, strikes: newStrikes }))
      newStrikes.forEach((s) => fetchedStrikesRef.current.add(s))
    }
    displayStrikes.forEach((s) => fetchedStrikesRef.current.add(s))

    // Fetch greeks directly from IB and update state
    fetchPairs.forEach(({ exp, strikes }) => {
      window.ibApi
        .getOptionGreeks(symbol, exp, strikes)
        .then((greeks) => {
          if (greeks.length === 0) return
          setAllGreeks((prev) => {
            const incoming = new Map<string, OptionGreek>(
              greeks.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g])
            )
            const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
            const updated = prev.map((g) => {
              const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`)
              return n ? mergeGreek(g, n) : g
            })
            const newEntries = greeks.filter(
              (g) => !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`)
            )
            return newEntries.length > 0 ? [...updated, ...newEntries] : updated
          })
        })
        .catch(() => { })
    })
  }, [displayExpirations, displayStrikes, symbol])

  // ── Refresh greeks every 2s ──────────────────────────────────────────────
  useEffect(() => {
    if (!symbol || displayExpirations.length === 0) return
    let cancelled = false

    const refresh = async (): Promise<void> => {
      const promises: Promise<void>[] = []

      // Refresh stock price
      promises.push(
        window.ibApi
          .getStockQuote(symbol)
          .then((q) => {
            const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
            if (price && !cancelled) setStockPrice(price)
          })
          .catch(() => { })
      )

      for (const exp of displayExpirations) {
        promises.push(
          window.ibApi
            .getOptionGreeks(symbol, exp, displayStrikes)
            .then((greeks) => {
              if (cancelled || greeks.length === 0) return
              setAllGreeks((prev) => {
                const incoming = new Map<string, OptionGreek>(
                  greeks.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g])
                )
                const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
                const updated = prev.map((g) => {
                  const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`)
                  return n ? mergeGreek(g, n) : g
                })
                const newEntries = greeks.filter(
                  (g) => !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`)
                )
                return newEntries.length > 0 ? [...updated, ...newEntries] : updated
              })
            })
            .catch(() => { })
        )
      }
      await Promise.all(promises)
    }

    const id = setInterval(() => {
      void refresh()
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(id)
      if (cancelSubscriptionsOnCleanup) {
        window.ibApi.cancelOptionGreeksSubscriptions(symbol)
      }
    }
  }, [symbol, displayExpirations, displayStrikes, cancelSubscriptionsOnCleanup])

  // ── Group greeks by expiry ────────────────────────────────────────────────
  const greeksByExpiry = useMemo(() => {
    const map = new Map<string, Map<string, OptionGreek>>()
    allGreeks.forEach((g) => {
      if (!map.has(g.expiry)) map.set(g.expiry, new Map())
      map.get(g.expiry)!.set(`${g.strike}_${g.right}`, g)
    })
    return map
  }, [allGreeks])

  const dataReady = displayExpirations.length > 0 && displayStrikes.length > 0

  return {
    // State
    chainParams,
    loadingChain,
    stockPrice,
    setStockPrice,
    stockPriceSymbolRef,
    errorMsg,
    setErrorMsg,
    allGreeks,
    setAllGreeks,

    // Filters
    availableExpirations,
    availableStrikes,
    selectedExpirations,
    setSelectedExpirations,
    selectedStrikes,
    setSelectedStrikes,
    expiryDropdownOpen,
    setExpiryDropdownOpen,
    strikeDropdownOpen,
    setStrikeDropdownOpen,
    chainHidden,
    setChainHidden,
    strikeDropdownRef,
    strikeScrolledRef,
    userModifiedStrikesRef,

    // Display
    displayExpirations,
    displayStrikes,
    greeksByExpiry,
    dataReady,

    // Actions
    fetchChain,
    resetChain,
    toggleExpiry,
    toggleStrike
  }
}
