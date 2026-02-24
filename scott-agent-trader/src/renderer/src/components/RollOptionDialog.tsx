import React from 'react'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

interface OptionChainParams {
  exchange: string
  underlyingConId: number
  tradingClass: string
  multiplier: string
  expirations: string[]
  strikes: number[]
}

interface OptionGreek {
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

interface RollOptionDialogProps {
  open: boolean
  onClose: () => void
  selectedPositions: PositionData[]
  accounts: AccountData[]
}

// Format expiry "20260220" -> "Feb20"
function formatExpiry(expiry: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ]
  const year = expiry.substring(2, 4)
  const month = months[parseInt(expiry.substring(4, 6)) - 1]
  const day = expiry.substring(6, 8).replace(/^0/, '')
  return `${month}${day} '${year}`
}

function midPrice(greek: OptionGreek | undefined): number | null {
  if (!greek) return null
  if (greek.bid > 0 && greek.ask > 0) return (greek.bid + greek.ask) / 2
  if (greek.last > 0) return greek.last
  return null
}

const formatPrice = (v: number): string => (v > 0 ? v.toFixed(2) : '-')
const formatDelta = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '-'
  return v.toFixed(3)
}

export default function RollOptionDialog({
  open,
  onClose,
  selectedPositions,
  accounts
}: RollOptionDialogProps): React.JSX.Element | null {
  // Snapshot positions on open so parent re-renders don't cause re-fetches
  const snappedPositions = useRef<PositionData[]>([])
  const snappedAccounts = useRef<AccountData[]>([])

  const [chainParams, setChainParams] = useState<OptionChainParams[]>([])
  const [targetExpiry, setTargetExpiry] = useState('')
  const [targetStrike, setTargetStrike] = useState<number | null>(null)
  const [targetRight, setTargetRight] = useState<'C' | 'P' | null>(null)
  const [loadingChain, setLoadingChain] = useState(false)
  const [currentGreeks, setCurrentGreeks] = useState<OptionGreek[]>([])
  const [allTargetGreeks, setAllTargetGreeks] = useState<OptionGreek[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [greeksFetched, setGreeksFetched] = useState(false)
  const [stockPrice, setStockPrice] = useState<number | null>(null)
  const [selectedExpirations, setSelectedExpirations] = useState<string[]>([])
  const [expiryDropdownOpen, setExpiryDropdownOpen] = useState(false)
  const [selectedStrikes, setSelectedStrikes] = useState<number[]>([])
  const [strikeDropdownOpen, setStrikeDropdownOpen] = useState(false)
  const fetchedExpiriesRef = useRef<Set<string>>(new Set())
  const fetchedStrikesRef = useRef<Set<number>>(new Set())
  const strikeDropdownRef = useRef<HTMLDivElement>(null)
  const [chainHidden, setChainHidden] = useState(false)
  const [limitPrice, setLimitPrice] = useState('')
  const [limitDropdownOpen, setLimitDropdownOpen] = useState(false)
  const limitInputRef = useRef<HTMLInputElement>(null)
  const limitDropdownRef = useRef<HTMLDivElement>(null)
  const [submitting, setSubmitting] = useState(false)

  // Snapshot on open
  useEffect(() => {
    if (open) {
      snappedPositions.current = selectedPositions
      snappedAccounts.current = accounts
    }
  }, [open]) // only on open change

  // Use snapped data
  const positions = open ? snappedPositions.current : []
  const accts = open ? snappedAccounts.current : []

  // Derive common properties
  const symbol = positions[0]?.symbol || ''

  // Unique current expiry/strike combos - stable via ref
  const currentCombosKey = positions
    .map((p) => `${p.expiry}_${p.strike}`)
    .sort()
    .join(',')

  const currentCombos = useMemo(() => {
    const map = new Map<string, { expiry: string; strike: number }>()
    positions.forEach((p) => {
      const key = `${p.expiry}_${p.strike}`
      if (!map.has(key)) {
        map.set(key, { expiry: p.expiry || '', strike: p.strike || 0 })
      }
    })
    return Array.from(map.values())
  }, [currentCombosKey])

  const getAlias = useCallback(
    (accountId: string): string => {
      const acct = accts.find((a) => a.accountId === accountId)
      return acct?.alias || accountId
    },
    [accts]
  )

  // Available expirations (only after current positions' expiry)
  const maxCurrentExpiry = useMemo(
    () => currentCombos.reduce((max, c) => (c.expiry > max ? c.expiry : max), ''),
    [currentCombos]
  )

  const availableExpirations = useMemo(() => {
    const set = new Set<string>()
    chainParams.forEach((p) => p.expirations.forEach((e) => set.add(e)))
    return Array.from(set)
      .filter((e) => e >= maxCurrentExpiry)
      .sort()
  }, [chainParams, maxCurrentExpiry])

  // Available strikes from chain
  const availableStrikes = useMemo(() => {
    const set = new Set<number>()
    chainParams.forEach((p) => p.strikes.forEach((s) => set.add(s)))
    return Array.from(set).sort((a, b) => a - b)
  }, [chainParams])

  // Auto-select first 3 expirations when available
  useEffect(() => {
    if (availableExpirations.length > 0 && selectedExpirations.length === 0) {
      setSelectedExpirations(availableExpirations.slice(0, 3))
    }
  }, [availableExpirations])

  // Auto-select nearby strikes (±5 around stock price or current position strike) when available
  useEffect(() => {
    if (availableStrikes.length > 0 && selectedStrikes.length === 0) {
      // Use stock price if available, otherwise fall back to current position's strike
      const centerPrice =
        stockPrice ??
        (currentCombos.length > 0 ? Math.max(...currentCombos.map((c) => c.strike)) : null)
      if (centerPrice === null) return
      const centerIdx = availableStrikes.findIndex((s) => s >= centerPrice)
      const idx = centerIdx === -1 ? availableStrikes.length - 1 : centerIdx
      const nearbyRange = 5
      const startIdx = Math.max(0, idx - nearbyRange)
      const endIdx = Math.min(availableStrikes.length, idx + nearbyRange + 1)
      setSelectedStrikes(availableStrikes.slice(startIdx, endIdx).slice(0, 10))
    }
  }, [availableStrikes, stockPrice, currentCombos])

  // Scroll strike dropdown to first checked item on open
  useEffect(() => {
    if (strikeDropdownOpen && strikeDropdownRef.current) {
      const firstChecked = strikeDropdownRef.current.querySelector('.roll-expiry-option.checked')
      if (firstChecked) {
        firstChecked.scrollIntoView({ block: 'start' })
      }
    }
  }, [strikeDropdownOpen])

  const displayExpirations = useMemo(
    () => selectedExpirations.filter((e) => availableExpirations.includes(e)).sort(),
    [selectedExpirations, availableExpirations]
  )

  const displayStrikes = useMemo(
    () => selectedStrikes.filter((s) => availableStrikes.includes(s)).sort((a, b) => a - b),
    [selectedStrikes, availableStrikes]
  )

  const toggleExpiry = useCallback((exp: string) => {
    setSelectedExpirations((prev) => {
      if (prev.includes(exp)) {
        return prev.filter((e) => e !== exp)
      }
      if (prev.length >= 5) {
        const sorted = [...prev].sort()
        // Clicking below range → drop latest; clicking above → drop earliest
        const drop = exp < sorted[0] ? sorted[sorted.length - 1] : sorted[0]
        return [...prev.filter((e) => e !== drop), exp]
      }
      return [...prev, exp]
    })
  }, [])

  const toggleStrike = useCallback((strike: number) => {
    setSelectedStrikes((prev) => {
      if (prev.includes(strike)) {
        return prev.filter((s) => s !== strike)
      }
      if (prev.length >= 10) {
        // Clicking below range → drop largest; clicking above → drop smallest
        const drop = strike < Math.min(...prev) ? Math.max(...prev) : Math.min(...prev)
        return [...prev.filter((s) => s !== drop), strike]
      }
      return [...prev, strike]
    })
  }, [])

  // Stable key for greeks fetch trigger
  const fetchKey = useMemo(() => {
    if (displayExpirations.length === 0 || displayStrikes.length === 0) return ''
    return `${symbol}_${displayExpirations.join(',')}_${displayStrikes.join(',')}_${currentCombosKey}`
  }, [symbol, displayExpirations, displayStrikes, currentCombosKey])

  // Fetch option chain on dialog open
  useEffect(() => {
    if (!open || !symbol) return
    setLoadingChain(true)
    setChainParams([])
    setTargetExpiry('')
    setTargetStrike(null)
    setTargetRight(null)
    setCurrentGreeks([])
    setAllTargetGreeks([])
    setErrorMsg('')
    setGreeksFetched(false)
    setSelectedExpirations([])
    setSelectedStrikes([])
    setStockPrice(null)
    fetchedExpiriesRef.current = new Set()
    fetchedStrikesRef.current = new Set()

    // Fetch stock price for strike centering
    window.ibApi
      .getStockQuote(symbol)
      .then((q) => {
        const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
        if (price) setStockPrice(price)
      })
      .catch(() => {})

    window.ibApi
      .getOptionChain(symbol)
      .then((params) => {
        setChainParams(params)
        if (params.length === 0) setErrorMsg('未找到期權鏈資料')
      })
      .catch((err: unknown) => {
        setErrorMsg(`查詢失敗: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoadingChain(false))
  }, [open, symbol])

  // Fetch current position greeks once
  useEffect(() => {
    if (!fetchKey || greeksFetched) return
    setGreeksFetched(true)

    const currentExpiries = [...new Set(currentCombos.map((c) => c.expiry))]
    currentExpiries.forEach((exp) => {
      const strikesForExp = currentCombos.filter((c) => c.expiry === exp).map((c) => c.strike)
      window.ibApi.getOptionGreeks(symbol, exp, strikesForExp).then((greeks) => {
        setCurrentGreeks((prev) => [...prev, ...greeks])
      })
    })
  }, [fetchKey, greeksFetched])

  // Fetch target greeks incrementally per selected expiry AND new strikes
  useEffect(() => {
    if (displayStrikes.length === 0 || !symbol) return
    const newExpiries = displayExpirations.filter((e) => !fetchedExpiriesRef.current.has(e))
    const newStrikes = displayStrikes.filter((s) => !fetchedStrikesRef.current.has(s))

    // Determine what to fetch:
    // 1. New expiries → fetch all displayStrikes for them
    // 2. New strikes (but no new expiries) → fetch only new strikes for all existing expiries
    const fetchPairs: { exp: string; strikes: number[] }[] = []

    if (newExpiries.length > 0) {
      newExpiries.forEach((exp) => {
        fetchPairs.push({ exp, strikes: displayStrikes })
        fetchedExpiriesRef.current.add(exp)
      })
    }
    if (newStrikes.length > 0) {
      // For already-fetched expiries, fetch only the new strikes
      const existingExpiries = displayExpirations.filter((e) => !newExpiries.includes(e))
      existingExpiries.forEach((exp) => {
        fetchPairs.push({ exp, strikes: newStrikes })
      })
      newStrikes.forEach((s) => fetchedStrikesRef.current.add(s))
    }
    // Also track current strikes
    displayStrikes.forEach((s) => fetchedStrikesRef.current.add(s))

    if (fetchPairs.length === 0) return

    let completed = 0
    const totalFetches = fetchPairs.length
    const fetchedGreeks: OptionGreek[] = []
    fetchPairs.forEach(({ exp, strikes }) => {
      window.ibApi
        .getOptionGreeks(symbol, exp, strikes)
        .then((greeks) => {
          fetchedGreeks.push(...greeks)
          setAllTargetGreeks((prev) => [...prev, ...greeks])
          completed++
          if (completed >= totalFetches) {
            // Check for missing delta (delta===0 but has bid/ask data) and retry after 3s
            const missingDeltaExpiries = new Set<string>()
            fetchedGreeks.forEach((g) => {
              if (g.delta === 0 && (g.bid > 0 || g.ask > 0)) {
                missingDeltaExpiries.add(g.expiry)
              }
            })
            if (missingDeltaExpiries.size > 0) {
              setTimeout(() => {
                const retryExpiries = Array.from(missingDeltaExpiries)
                console.log(
                  '[RollOption] Retrying greeks for expiries with missing delta:',
                  retryExpiries
                )
                retryExpiries.forEach((exp) => {
                  window.ibApi.getOptionGreeks(symbol, exp, displayStrikes).then((retryGreeks) => {
                    setAllTargetGreeks((prev) => {
                      // Replace entries for retried expiry with new data
                      const filtered = prev.filter((g) => g.expiry !== exp)
                      return [...filtered, ...retryGreeks]
                    })
                  })
                })
              }, 3000)
              // cleanup handled by useEffect return
            }
          }
        })
        .catch((err: unknown) => {
          completed++
          setErrorMsg(`取得報價失敗: ${err instanceof Error ? err.message : String(err)}`)
        })
    })
  }, [displayExpirations, displayStrikes, symbol])

  // Auto-refresh greeks — non-overlapping to avoid IB API exhaustion
  const refreshingRef = useRef(false)
  useEffect(() => {
    if (!symbol || displayStrikes.length === 0) return
    const currentExpiries = [...new Set(currentCombos.map((c) => c.expiry))]
    if (currentExpiries.length === 0 && displayExpirations.length === 0) return

    let cancelled = false

    async function refreshGreeks(): Promise<void> {
      if (refreshingRef.current || cancelled) return
      refreshingRef.current = true
      try {
        const promises: Promise<void>[] = []
        // Refresh current position greeks
        currentExpiries.forEach((exp) => {
          const strikesForExp = currentCombos.filter((c) => c.expiry === exp).map((c) => c.strike)
          promises.push(
            window.ibApi.getOptionGreeks(symbol, exp, strikesForExp).then((greeks) => {
              if (cancelled || greeks.length === 0) return
              setCurrentGreeks((prev) => {
                const mergeGreek = (old: OptionGreek, n: OptionGreek): OptionGreek => ({
                  ...old,
                  bid: n.bid > 0 ? n.bid : old.bid,
                  ask: n.ask > 0 ? n.ask : old.ask,
                  last: n.last > 0 ? n.last : old.last,
                  delta: n.delta !== 0 ? n.delta : old.delta,
                  gamma: n.gamma !== 0 ? n.gamma : old.gamma,
                  theta: n.theta !== 0 ? n.theta : old.theta,
                  vega: n.vega !== 0 ? n.vega : old.vega,
                  impliedVol: n.impliedVol > 0 ? n.impliedVol : old.impliedVol
                })
                const incoming = new Map<string, OptionGreek>(
                  greeks.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g])
                )
                const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
                const updated = prev.map((g) => {
                  const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`)
                  return n ? mergeGreek(g, n) : g
                })
                const newEntries = greeks.filter(
                  (g) =>
                    !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`) &&
                    (g.bid > 0 || g.ask > 0 || g.delta !== 0)
                )
                return newEntries.length > 0 ? [...updated, ...newEntries] : updated
              })
            })
          )
        })
        // Refresh stock price
        promises.push(
          window.ibApi.getStockQuote(symbol).then((q) => {
            if (cancelled) return
            const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
            if (price) setStockPrice(price)
          })
        )
        // Refresh target greeks
        displayExpirations.forEach((exp) => {
          promises.push(
            window.ibApi.getOptionGreeks(symbol, exp, displayStrikes).then((greeks) => {
              if (cancelled || greeks.length === 0) return
              setAllTargetGreeks((prev) => {
                const mergeGreek = (old: OptionGreek, n: OptionGreek): OptionGreek => ({
                  ...old,
                  bid: n.bid > 0 ? n.bid : old.bid,
                  ask: n.ask > 0 ? n.ask : old.ask,
                  last: n.last > 0 ? n.last : old.last,
                  delta: n.delta !== 0 ? n.delta : old.delta,
                  gamma: n.gamma !== 0 ? n.gamma : old.gamma,
                  theta: n.theta !== 0 ? n.theta : old.theta,
                  vega: n.vega !== 0 ? n.vega : old.vega,
                  impliedVol: n.impliedVol > 0 ? n.impliedVol : old.impliedVol
                })
                const incoming = new Map<string, OptionGreek>(
                  greeks.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g])
                )
                const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
                const updated = prev.map((g) => {
                  const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`)
                  return n ? mergeGreek(g, n) : g
                })
                const newEntries = greeks.filter(
                  (g) =>
                    !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`) &&
                    (g.bid > 0 || g.ask > 0 || g.delta !== 0)
                )
                return newEntries.length > 0 ? [...updated, ...newEntries] : updated
              })
            })
          )
        })
        await Promise.all(promises)
      } catch {
        // ignore refresh errors
      } finally {
        refreshingRef.current = false
      }
    }

    const interval = setInterval(refreshGreeks, 3000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [symbol, currentCombos, displayExpirations, displayStrikes])

  // Group target greeks by expiry
  const greeksByExpiry = useMemo(() => {
    const map = new Map<string, Map<string, OptionGreek>>()
    allTargetGreeks.forEach((g) => {
      if (!map.has(g.expiry)) map.set(g.expiry, new Map())
      map.get(g.expiry)!.set(`${g.strike}_${g.right}`, g)
    })
    return map
  }, [allTargetGreeks])

  const handleSelect = useCallback((expiry: string, strike: number, right: 'C' | 'P') => {
    setTargetExpiry(expiry)
    setTargetStrike(strike)
    setTargetRight(right)
  }, [])

  const findCurrentGreek = useCallback(
    (pos: PositionData): OptionGreek | undefined => {
      const pr = pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P'
      return currentGreeks.find(
        (g) => g.expiry === pos.expiry && g.strike === pos.strike && g.right === pr
      )
    },
    [currentGreeks]
  )

  const targetGreek = useMemo(() => {
    if (!targetExpiry || targetStrike === null || targetRight === null) return undefined
    return allTargetGreeks.find(
      (g) => g.expiry === targetExpiry && g.strike === targetStrike && g.right === targetRight
    )
  }, [allTargetGreeks, targetExpiry, targetStrike, targetRight])

  // Compute spread prices (net credit/debit for the roll)
  const spreadPrices = useMemo(() => {
    if (!targetGreek || positions.length === 0) return null
    const pos0 = positions[0]
    const curGreek = findCurrentGreek(pos0)
    if (!curGreek) return null
    // Roll = close current (buy back if short) + open target (sell if short)
    // TWS convention: negative = net credit (receive money), positive = net debit (pay money)
    const isShort = pos0.quantity < 0
    const spreadBid = isShort
      ? curGreek.ask - targetGreek.bid // worst: buy current at ask, sell target at bid
      : targetGreek.ask - curGreek.bid // long: buy target at ask, sell current at bid
    const spreadAsk = isShort
      ? curGreek.bid - targetGreek.ask // best: buy current at bid, sell target at ask
      : targetGreek.bid - curGreek.ask
    const spreadMid = (spreadBid + spreadAsk) / 2
    return { bid: spreadBid, ask: spreadAsk, mid: spreadMid }
  }, [targetGreek, positions, findCurrentGreek])

  // Auto-populate limit price with mid price whenever spread changes (new target selected)
  useEffect(() => {
    if (spreadPrices) {
      setLimitPrice(spreadPrices.mid.toFixed(2))
    }
  }, [spreadPrices])

  // Scroll dropdown to mid-price when it opens
  useEffect(() => {
    if (limitDropdownOpen && limitDropdownRef.current && spreadPrices) {
      const midVal = spreadPrices.mid.toFixed(2)
      const midEl = limitDropdownRef.current.querySelector(
        `[data-price="${midVal}"]`
      ) as HTMLElement | null
      if (midEl) {
        midEl.scrollIntoView({ block: 'center' })
      }
    }
  }, [limitDropdownOpen, spreadPrices])

  // Generate price options for the limit price dropdown (extended range around BID/ASK)
  const priceOptions = useMemo(() => {
    if (!spreadPrices) return []
    const options: string[] = []
    const lo = Math.min(spreadPrices.bid, spreadPrices.ask)
    const hi = Math.max(spreadPrices.bid, spreadPrices.ask)
    // Extend range by 0.30 on each side to show more price options
    const extLo = lo - 0.3
    const extHi = hi + 0.3
    const steps = Math.min(Math.round((extHi - extLo) / 0.01) + 1, 200)
    for (let i = 0; i < steps; i++) {
      const price = extHi - i * 0.01
      options.push(price.toFixed(2))
    }
    return options
  }, [spreadPrices])

  // Close limit dropdown on click outside
  useEffect(() => {
    if (!limitDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (limitInputRef.current && !limitInputRef.current.contains(e.target as Node)) {
        setLimitDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [limitDropdownOpen])

  if (!open) return null

  const targetMid = midPrice(targetGreek)
  const dataReady =
    !loadingChain &&
    displayExpirations.length > 0 &&
    displayStrikes.length > 0 &&
    allTargetGreeks.length > 0

  return (
    <div className="roll-dialog-overlay" onClick={onClose}>
      <div className="roll-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="roll-dialog-header">
          <h3>{symbol} 批次展期</h3>
          <button className="roll-dialog-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="roll-dialog-body">
          {errorMsg && <div className="roll-dialog-error">{errorMsg}</div>}
          {!dataReady && (
            <>
              <div className="roll-selectors-row">
                <div className="roll-expiry-selector">
                  <button className="roll-expiry-dropdown-btn" disabled style={{ opacity: 0.5 }}>
                    最後交易日 ▾ <span className="roll-expiry-count">-</span>
                  </button>
                </div>
                <div className="roll-expiry-selector">
                  <button className="roll-expiry-dropdown-btn" disabled style={{ opacity: 0.5 }}>
                    行使價 ▾ <span className="roll-expiry-count">-</span>
                  </button>
                </div>
              </div>
              <div className="roll-chain-multi">
                <table className="roll-chain-table">
                  <thead>
                    <tr>
                      <th colSpan={4} className="roll-chain-side-header roll-chain-call-header">
                        CALL
                      </th>
                      <th className="roll-chain-desc-header"></th>
                      <th colSpan={4} className="roll-chain-side-header roll-chain-put-header">
                        PUT
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="roll-chain-expiry-row">
                      <td>買價</td>
                      <td>賣價</td>
                      <td>最後價</td>
                      <td>Delta</td>
                      <td className="roll-chain-expiry-label">載入中...</td>
                      <td>買價</td>
                      <td>賣價</td>
                      <td>最後價</td>
                      <td>Delta</td>
                    </tr>
                    {Array.from({ length: 10 }, (_, i) => (
                      <tr key={`skel-${i}`}>
                        <td className="roll-chain-cell roll-chain-call">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-cell roll-chain-call">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-cell roll-chain-call">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-cell roll-chain-call">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-strike">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-cell roll-chain-put">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-cell roll-chain-put">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-cell roll-chain-put">
                          <span className="skeleton-bar" />
                        </td>
                        <td className="roll-chain-cell roll-chain-put">
                          <span className="skeleton-bar" />
                        </td>
                      </tr>
                    ))}
                    <tr className="roll-chain-expiry-row">
                      <td>買價</td>
                      <td>賣價</td>
                      <td>最後價</td>
                      <td>Delta</td>
                      <td className="roll-chain-expiry-label">
                        <span className="skeleton-bar" style={{ width: 60 }} />
                      </td>
                      <td>買價</td>
                      <td>賣價</td>
                      <td>最後價</td>
                      <td>Delta</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Selectors row */}
          {dataReady && (availableExpirations.length > 0 || availableStrikes.length > 0) && (
            <div className="roll-selectors-row">
              {/* Expiry date selector */}
              {availableExpirations.length > 0 && (
                <div className="roll-expiry-selector">
                  <button
                    className="roll-expiry-dropdown-btn"
                    onClick={() => setExpiryDropdownOpen((v) => !v)}
                  >
                    最後交易日 ▾{' '}
                    <span className="roll-expiry-count">{selectedExpirations.length}</span>
                  </button>
                  {expiryDropdownOpen && (
                    <>
                      <div
                        className="roll-expiry-backdrop"
                        onClick={() => setExpiryDropdownOpen(false)}
                      />
                      <div className="roll-expiry-dropdown">
                        {availableExpirations.map((exp) => (
                          <label
                            key={exp}
                            className={`roll-expiry-option ${selectedExpirations.includes(exp) ? 'checked' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedExpirations.includes(exp)}
                              onChange={() => toggleExpiry(exp)}
                            />
                            {formatExpiry(exp)}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Strike selector */}
              {availableStrikes.length > 0 && (
                <div className="roll-expiry-selector">
                  <button
                    className="roll-expiry-dropdown-btn"
                    onClick={() => setStrikeDropdownOpen((v) => !v)}
                  >
                    行使價 ▾ <span className="roll-expiry-count">{selectedStrikes.length}</span>
                  </button>
                  {strikeDropdownOpen && (
                    <>
                      <div
                        className="roll-expiry-backdrop"
                        onClick={() => setStrikeDropdownOpen(false)}
                      />
                      <div className="roll-expiry-dropdown" ref={strikeDropdownRef}>
                        {availableStrikes.map((strike) => (
                          <label
                            key={strike}
                            className={`roll-expiry-option ${selectedStrikes.includes(strike) ? 'checked' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedStrikes.includes(strike)}
                              onChange={() => toggleStrike(strike)}
                            />
                            {strike}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button
                className="roll-expiry-dropdown-btn"
                onClick={() => setChainHidden((v) => !v)}
              >
                {chainHidden ? '顯示期權鏈 ▼' : '隱藏期權鏈 ▲'}
              </button>
              {stockPrice !== null && (
                <span className="roll-stock-price">
                  {symbol} 股價 {stockPrice.toFixed(2)}
                </span>
              )}
            </div>
          )}

          {/* Multi-expiry option chain - show table structure as soon as chain is ready */}
          {dataReady && !chainHidden && (
            <div className="roll-chain-multi">
              <table className="roll-chain-table">
                <thead>
                  <tr>
                    <th colSpan={4} className="roll-chain-side-header roll-chain-call-header">
                      CALL
                    </th>
                    <th className="roll-chain-desc-header"></th>
                    <th colSpan={4} className="roll-chain-side-header roll-chain-put-header">
                      PUT
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayExpirations.map((expiry) => {
                    const greeksMap = greeksByExpiry.get(expiry)
                    return [
                      <tr key={`header-${expiry}`} className="roll-chain-expiry-row">
                        <td>買價</td>
                        <td>賣價</td>
                        <td>最後價</td>
                        <td>Delta</td>
                        <td className="roll-chain-expiry-label">{formatExpiry(expiry)}</td>
                        <td>買價</td>
                        <td>賣價</td>
                        <td>最後價</td>
                        <td>Delta</td>
                      </tr>,
                      ...displayStrikes.map((strike) => {
                        const callGreek = greeksMap?.get(`${strike}_C`)
                        const putGreek = greeksMap?.get(`${strike}_P`)
                        const callSelected =
                          targetExpiry === expiry && targetStrike === strike && targetRight === 'C'
                        const putSelected =
                          targetExpiry === expiry && targetStrike === strike && targetRight === 'P'

                        return (
                          <tr key={`${expiry}-${strike}`}>
                            <td
                              className={`roll-chain-cell roll-chain-call ${callSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'C')}
                            >
                              {callGreek ? formatPrice(callGreek.bid) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-call ${callSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'C')}
                            >
                              {callGreek ? formatPrice(callGreek.ask) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-call ${callSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'C')}
                            >
                              {callGreek ? formatPrice(callGreek.last) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-call ${callSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'C')}
                            >
                              {callGreek ? formatDelta(callGreek.delta) : '-'}
                            </td>
                            <td className="roll-chain-strike">{strike}</td>
                            <td
                              className={`roll-chain-cell roll-chain-put ${putSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'P')}
                            >
                              {putGreek ? formatPrice(putGreek.bid) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-put ${putSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'P')}
                            >
                              {putGreek ? formatPrice(putGreek.ask) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-put ${putSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'P')}
                            >
                              {putGreek ? formatPrice(putGreek.last) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-put ${putSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'P')}
                            >
                              {putGreek ? formatDelta(putGreek.delta) : '-'}
                            </td>
                          </tr>
                        )
                      })
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Order entry section */}
          <div className="roll-order-section">
            <span className="roll-order-label">買價</span>
            <button
              className="roll-order-price-btn roll-order-bid"
              disabled={!spreadPrices}
              onClick={() => spreadPrices && setLimitPrice(spreadPrices.bid.toFixed(2))}
            >
              {spreadPrices ? spreadPrices.bid.toFixed(2) : '-'}
            </button>
            <span className="roll-order-label">賣價</span>
            <button
              className="roll-order-price-btn roll-order-ask"
              disabled={!spreadPrices}
              onClick={() => spreadPrices && setLimitPrice(spreadPrices.ask.toFixed(2))}
            >
              {spreadPrices ? spreadPrices.ask.toFixed(2) : '-'}
            </button>
            <span className="roll-order-label">限價</span>
            <div className="roll-limit-wrapper" ref={limitInputRef}>
              <input
                type="text"
                className="roll-order-input"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                onFocus={() => priceOptions.length > 0 && setLimitDropdownOpen(true)}
                onClick={() => priceOptions.length > 0 && setLimitDropdownOpen(true)}
                placeholder="0.00"
                style={
                  spreadPrices
                    ? limitPrice === spreadPrices.bid.toFixed(2)
                      ? { borderColor: '#22c55e', color: '#15803d' }
                      : limitPrice === spreadPrices.ask.toFixed(2)
                        ? { borderColor: '#ef4444', color: '#b91c1c' }
                        : {}
                    : {}
                }
              />
              <span
                className="roll-limit-arrow"
                onClick={() => priceOptions.length > 0 && setLimitDropdownOpen((v) => !v)}
              >
                ▾
              </span>
              {limitDropdownOpen &&
                priceOptions.length > 0 &&
                createPortal(
                  <div
                    className="roll-limit-dropdown"
                    ref={limitDropdownRef}
                    style={{
                      position: 'fixed',
                      bottom:
                        window.innerHeight -
                        (limitInputRef.current?.getBoundingClientRect().top ?? 0) +
                        2,
                      left: limitInputRef.current?.getBoundingClientRect().left ?? 0,
                      minWidth: limitInputRef.current?.getBoundingClientRect().width ?? 120
                    }}
                  >
                    {priceOptions.map((opt) => {
                      const askVal = spreadPrices
                        ? Math.max(spreadPrices.bid, spreadPrices.ask).toFixed(2)
                        : ''
                      const bidVal = spreadPrices
                        ? Math.min(spreadPrices.bid, spreadPrices.ask).toFixed(2)
                        : ''
                      const midVal = spreadPrices ? spreadPrices.mid.toFixed(2) : ''
                      return (
                        <div
                          key={opt}
                          data-price={opt}
                          className={`roll-limit-option ${opt === limitPrice ? 'selected' : ''}`}
                          onMouseDown={() => {
                            setLimitPrice(opt)
                            setLimitDropdownOpen(false)
                          }}
                        >
                          {opt}
                          {opt === bidVal && (
                            <span className="roll-limit-tag roll-limit-tag-bid"> (買價)</span>
                          )}
                          {opt === midVal && opt !== bidVal && opt !== askVal && (
                            <span className="roll-limit-tag roll-limit-tag-mid"> (中間價)</span>
                          )}
                          {opt === askVal && (
                            <span className="roll-limit-tag roll-limit-tag-ask"> (賣價)</span>
                          )}
                        </div>
                      )
                    })}
                  </div>,
                  document.body
                )}
            </div>
          </div>

          {/* Positions table */}
          {positions.length > 0 && (
            <>
              <div className="roll-dialog-table-wrapper">
                <table className="roll-dialog-table roll-positions-table">
                  <tbody>
                    {positions.map((pos, idx) => {
                      const curGreek = findCurrentGreek(pos)
                      const curMid = midPrice(curGreek)
                      const liveSpread =
                        curMid !== null && targetMid !== null ? curMid - targetMid : null
                      // Show user's limit price if set, otherwise show live spread
                      const displayVal = limitPrice ? parseFloat(limitPrice) : liveSpread
                      const rightLabel = pos.right === 'C' ? 'C' : pos.right === 'P' ? 'P' : ''
                      const closePrefix = pos.quantity < 0 ? '+' : '-'
                      const openPrefix = pos.quantity < 0 ? '-' : '+'
                      const strikeStr = Number.isInteger(pos.strike)
                        ? pos.strike
                        : (pos.strike || 0).toFixed(1)
                      const currentDesc = `${closePrefix}${symbol} ${pos.expiry ? formatExpiry(pos.expiry) : ''} ${strikeStr}${rightLabel}`
                      const targetDesc =
                        targetExpiry && targetStrike !== null && targetRight
                          ? `${openPrefix}${symbol} ${formatExpiry(targetExpiry)} ${Number.isInteger(targetStrike) ? targetStrike : targetStrike.toFixed(1)}${targetRight === 'C' ? 'C' : 'P'}`
                          : '-'

                      return (
                        <tr key={idx}>
                          <td
                            style={{
                              color: '#999',
                              textAlign: 'center',
                              width: '1px',
                              whiteSpace: 'nowrap'
                            }}
                          >{`${idx + 1}.`}</td>
                          <td style={{ fontWeight: 'bold' }}>{getAlias(pos.account)}</td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {Math.abs(pos.quantity)}口
                          </td>
                          <td>{currentDesc}</td>
                          <td style={{ backgroundColor: '#e0f2fe' }}>{targetDesc}</td>
                          <td
                            className={
                              displayVal !== null && !isNaN(displayVal as number)
                                ? (displayVal as number) <= 0
                                  ? 'spread-positive'
                                  : 'spread-negative'
                                : ''
                            }
                            style={
                              spreadPrices && limitPrice
                                ? limitPrice === spreadPrices.bid.toFixed(2)
                                  ? { color: '#15803d' }
                                  : limitPrice === spreadPrices.ask.toFixed(2)
                                    ? { color: '#b91c1c' }
                                    : {}
                                : {}
                            }
                          >
                            {displayVal !== null && !isNaN(displayVal as number)
                              ? `${(displayVal as number) >= 0 ? '+' : ''}${(displayVal as number).toFixed(2)}`
                              : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="roll-dialog-footer">
          <button className="roll-dialog-cancel" onClick={onClose}>
            取消
          </button>
          <button
            className="roll-dialog-confirm"
            disabled={
              !targetExpiry ||
              targetStrike === null ||
              targetRight === null ||
              !limitPrice ||
              submitting
            }
            onClick={async () => {
              if (!targetExpiry || targetStrike === null || targetRight === null || !limitPrice)
                return
              setSubmitting(true)
              try {
                for (const pos of positions) {
                  const qty = Math.abs(pos.quantity)
                  const isShort = pos.quantity < 0
                  // BUY to close short, SELL to close long
                  const closeAction = isShort ? 'BUY' : 'SELL'
                  await window.ibApi.placeRollOrder(
                    {
                      symbol,
                      closeExpiry: pos.expiry || '',
                      closeStrike: pos.strike || 0,
                      closeRight: pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P',
                      openExpiry: targetExpiry,
                      openStrike: targetStrike,
                      openRight: targetRight,
                      action: closeAction,
                      limitPrice: parseFloat(limitPrice),
                      outsideRth: true
                    },
                    { [pos.account]: qty }
                  )
                }
                onClose()
              } catch (err: unknown) {
                alert('展期下單失敗: ' + String(err))
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting
              ? '下單中...'
              : targetExpiry && targetStrike !== null && targetRight
                ? `確認展期 ${symbol} ${formatExpiry(targetExpiry)} ${Number.isInteger(targetStrike) ? targetStrike : targetStrike.toFixed(1)}${targetRight}`
                : '確認展期'}
          </button>
        </div>
      </div>
    </div>
  )
}
