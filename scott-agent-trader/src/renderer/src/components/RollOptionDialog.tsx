import React from 'react'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

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
const formatGreek = (v: number): string => {
  if (v === 0) return '-'
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
  const lastStrikeCenterRef = useRef<number | null>(null)
  const userModifiedStrikesRef = useRef(false)
  const fetchedSymbolRef = useRef('')
  const [chainHidden, setChainHidden] = useState(false)
  const [limitPrice, setLimitPrice] = useState('')
  const limitInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)

  // Snapshot on open — also compute currentCombosKeyRef for stable memoization
  useEffect(() => {
    if (open) {
      snappedPositions.current = selectedPositions
      snappedAccounts.current = accounts
      currentCombosKeyRef.current = selectedPositions
        .map((p) => `${p.expiry}_${p.strike}`)
        .sort()
        .join(',')
    }
  }, [open]) // only on open change

  // Use snapped data (direct ref access — snapshot effect runs before these are used)
  const positions = open ? snappedPositions.current : []
  const accts = open ? snappedAccounts.current : []

  // Derive common properties
  const symbol = positions[0]?.symbol || ''

  // Stable key for current combos — stored in a ref so it never changes on re-render
  // Inline computation from positions (a conditional expression) caused a new string
  // on every render → currentCombos useMemo recalculated every render →
  // polling effect restarted every render (cancelling the 2s interval).
  const currentCombosKeyRef = useRef('')

  const currentCombos = useMemo(() => {
    const map = new Map<string, { expiry: string; strike: number }>()
    positions.forEach((p) => {
      const key = `${p.expiry}_${p.strike}`
      if (!map.has(key)) {
        map.set(key, { expiry: p.expiry || '', strike: p.strike || 0 })
      }
    })
    return Array.from(map.values())
  }, [currentCombosKeyRef.current]) // eslint-disable-line react-hooks/exhaustive-deps


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
    return Array.from(set)
      .filter((s) => (s * 2) % 1 === 0)
      .sort((a, b) => a - b)
  }, [chainParams])

  // Auto-select first expiration when available
  useEffect(() => {
    if (availableExpirations.length > 0 && selectedExpirations.length === 0) {
      setSelectedExpirations(availableExpirations.slice(0, 1))
    }
  }, [availableExpirations])

  // ── Auto-select ±5 strikes around stock price ──
  // For roll dialog: initially center on position strike,
  // but re-center when stockPrice arrives.
  useEffect(() => {
    if (availableStrikes.length === 0) return
    if (userModifiedStrikesRef.current) return

    // Use stockPrice if available, otherwise fallback to position strike
    const posStrike = currentCombos[0]?.strike
    const centerPrice = stockPrice ?? posStrike
    if (!centerPrice) return

    // Only update if the center price has meaningfully changed
    // (e.g. from posStrike to stockPrice)
    if (lastStrikeCenterRef.current === Math.round(centerPrice)) return
    lastStrikeCenterRef.current = Math.round(centerPrice)

    const idx = availableStrikes.findIndex((s) => s >= centerPrice)
    const center = idx === -1 ? availableStrikes.length - 1 : idx
    const start = Math.max(0, center - 5)
    const end = Math.min(availableStrikes.length, center + 6)
    setSelectedStrikes(availableStrikes.slice(start, end).slice(0, 10))
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
    () =>
      selectedStrikes
        .filter((s) => availableStrikes.includes(s))
        .sort((a, b) => a - b),
    [selectedStrikes, availableStrikes]
  )

  const toggleExpiry = useCallback((exp: string) => {
    setSelectedExpirations([exp])
  }, [])

  const toggleStrike = useCallback((strike: number) => {
    userModifiedStrikesRef.current = true
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
    return `${symbol}_${displayExpirations.join(',')}_${displayStrikes.join(',')}_${currentCombosKeyRef.current}`
  }, [symbol, displayExpirations, displayStrikes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch option chain on dialog open
  useEffect(() => {
    if (!open || !symbol) return

    const isNewSymbol = fetchedSymbolRef.current !== symbol
    fetchedSymbolRef.current = symbol

    // Always reset order-specific state
    setTargetExpiry('')
    setTargetStrike(null)
    setTargetRight(null)
    setErrorMsg('')

    // Only reset all data when symbol changes (same-symbol = instant display with cached greeks)
    if (isNewSymbol) {
      setSelectedExpirations([])
      setChainParams([])
      setSelectedStrikes([])
      setStockPrice(null)
      setCurrentGreeks([])
      setAllTargetGreeks([])
      setGreeksFetched(false)
      fetchedExpiriesRef.current = new Set()
      fetchedStrikesRef.current = new Set()
      lastStrikeCenterRef.current = null
      userModifiedStrikesRef.current = false
    }

    // Fetch stock price for strike centering
    window.ibApi
      .getStockQuote(symbol)
      .then(async (q) => {
        const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
        if (price) {
          setStockPrice(price)
        } else {
          // Fallback: use preloader's cached stock price
          const cached = await window.ibApi.getCachedStockPrice(symbol)
          if (cached) setStockPrice(cached)
        }
      })
      .catch(() => { })

    window.ibApi
      .getOptionChain(symbol)
      .then((params) => {
        setChainParams(params)
        if (params.length === 0) setErrorMsg('未找到期權鏈資料')
      })
      .catch((err: unknown) => {
        setErrorMsg(`查詢失敗: ${err instanceof Error ? err.message : String(err)}`)
      })

  }, [open, symbol])

  // Request preload for current position greeks once
  useEffect(() => {
    if (!fetchKey || greeksFetched) return
    setGreeksFetched(true)

    const currentExpiries = [...new Set(currentCombos.map((c) => c.expiry))]
    currentExpiries.forEach((exp) => {
      const strikesForExp = currentCombos.filter((c) => c.expiry === exp).map((c) => c.strike)
      // Trigger preloader to fetch from IB; the polling effect below will pick up the results
      window.ibApi.requestPreload(symbol, exp, strikesForExp).catch(() => { })
    })
  }, [fetchKey, greeksFetched])

  // Request preload for target greeks incrementally per selected expiry AND new strikes
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
      existingExpiries.forEach((exp) => {
        fetchPairs.push({ exp, strikes: newStrikes })
      })
      newStrikes.forEach((s) => fetchedStrikesRef.current.add(s))
    }
    displayStrikes.forEach((s) => fetchedStrikesRef.current.add(s))

    // Trigger preloader to cache from IB (non-blocking); cache polling effect picks up results
    fetchPairs.forEach(({ exp, strikes }) => {
      window.ibApi.requestPreload(symbol, exp, strikes).catch(() => { })
    })
  }, [displayExpirations, displayStrikes, symbol])

  // Poll cache every 2s for both current position greeks and target greeks
  useEffect(() => {
    if (!symbol) return
    const currentExpiries = [...new Set(currentCombos.map((c) => c.expiry))]
    if (currentExpiries.length === 0 && displayExpirations.length === 0) return

    let cancelled = false

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

    const pollCache = async (): Promise<void> => {
      // Refresh stock price
      try {
        const q = await window.ibApi.getStockQuote(symbol)
        const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
        if (price && !cancelled) {
          setStockPrice(price)
        } else if (!cancelled) {
          // Fallback: use preloader's cached stock price
          const cached = await window.ibApi.getCachedStockPrice(symbol)
          if (cached) setStockPrice(cached)
        }
      } catch { /* non-fatal */ }

      // Refresh current position greeks from cache
      for (const exp of currentExpiries) {
        if (cancelled) return
        const strikesForExp = currentCombos.filter((c) => c.expiry === exp).map((c) => c.strike)
        const greeks = await window.ibApi.getCachedGreeks(symbol, exp).catch(() => [] as OptionGreek[])
        const filtered = greeks.filter((g) => strikesForExp.includes(g.strike))
        if (cancelled || filtered.length === 0) continue
        setCurrentGreeks((prev) => {
          const incoming = new Map<string, OptionGreek>(filtered.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g]))
          const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
          const updated = prev.map((g) => { const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`); return n ? mergeGreek(g, n) : g })
          const newEntries = filtered.filter((g) => !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`))
          return newEntries.length > 0 ? [...updated, ...newEntries] : updated
        })
      }

      // Refresh target greeks from cache
      for (const exp of displayExpirations) {
        if (cancelled) return
        const greeks = await window.ibApi.getCachedGreeks(symbol, exp).catch(() => [] as OptionGreek[])
        if (cancelled || greeks.length === 0) continue
        setAllTargetGreeks((prev) => {
          const incoming = new Map<string, OptionGreek>(greeks.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g]))
          const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
          const updated = prev.map((g) => { const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`); return n ? mergeGreek(g, n) : g })
          const newEntries = greeks.filter((g) => !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`))
          return newEntries.length > 0 ? [...updated, ...newEntries] : updated
        })
      }
    }

    void pollCache()
    const interval = setInterval(() => { void pollCache() }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [symbol, currentCombos, displayExpirations])



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

  // Auto-select best target contract once greeks load (same right, closest strike in selected expiry)
  useEffect(() => {
    if (allTargetGreeks.length === 0 || targetExpiry || targetStrike !== null) return
    const pos0 = positions[0]
    if (!pos0) return
    const right = pos0.right === 'C' || pos0.right === 'CALL' ? 'C' : 'P'
    const expiry = displayExpirations[0]
    if (!expiry) return
    const candidates = allTargetGreeks.filter((g) => g.expiry === expiry && g.right === right)
    if (candidates.length === 0) return
    // Pick closest strike to current position's strike
    const currentStrike = pos0.strike ?? 0
    const best = candidates.reduce((a, b) =>
      Math.abs(a.strike - currentStrike) <= Math.abs(b.strike - currentStrike) ? a : b
    )
    setTargetExpiry(best.expiry)
    setTargetStrike(best.strike)
    setTargetRight(best.right as 'C' | 'P')
  }, [allTargetGreeks, targetExpiry, targetStrike, positions, displayExpirations])




  if (!open) return null

  const targetMid = midPrice(targetGreek)
  const dataReady =
    displayExpirations.length > 0 &&
    displayStrikes.length > 0

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
                    {selectedExpirations.length > 0 ? formatExpiry(selectedExpirations[0]) : '最後交易日'} ▾
                  </button>
                  {expiryDropdownOpen && (
                    <>
                      <div
                        className="roll-expiry-backdrop"
                        onClick={() => setExpiryDropdownOpen(false)}
                      />
                      <div className="roll-expiry-dropdown">
                        {availableExpirations.map((exp) => (
                          <div
                            key={exp}
                            className={`roll-expiry-option ${selectedExpirations.includes(exp) ? 'checked' : ''}`}
                            onClick={() => { toggleExpiry(exp); setExpiryDropdownOpen(false) }}
                          >
                            {formatExpiry(exp)}
                          </div>
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
                    行使價 ▾
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
                        <td>DELTA</td>
                        <td>買價</td>
                        <td>賣價</td>
                        <td>最後價</td>
                        <td className="roll-chain-expiry-label">{formatExpiry(expiry)}</td>
                        <td>買價</td>
                        <td>賣價</td>
                        <td>最後價</td>
                        <td>DELTA</td>
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
                            {/* Call side: Delta | Bid | Ask | Last */}
                            <td
                              className={`roll-chain-cell roll-chain-call ${callSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'C')}
                            >
                              {callGreek ? formatGreek(callGreek.delta) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-call chain-bid ${callSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'C')}
                            >
                              {callGreek ? formatPrice(callGreek.bid) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-call chain-ask ${callSelected ? 'roll-chain-selected' : ''}`}
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
                            <td className="roll-chain-strike">{strike}</td>
                            {/* Put side: Bid | Ask | Last | Theta | Delta | IV */}
                            <td
                              className={`roll-chain-cell roll-chain-put chain-bid ${putSelected ? 'roll-chain-selected' : ''}`}
                              onClick={() => handleSelect(expiry, strike, 'P')}
                            >
                              {putGreek ? formatPrice(putGreek.bid) : '-'}
                            </td>
                            <td
                              className={`roll-chain-cell roll-chain-put chain-ask ${putSelected ? 'roll-chain-selected' : ''}`}
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
                              {putGreek ? formatGreek(putGreek.delta) : '-'}
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
            <span className="roll-order-value roll-order-bid">
              {spreadPrices ? spreadPrices.bid.toFixed(2) : '-'}
            </span>
            <span className="roll-order-label">賣價</span>
            <span className="roll-order-value roll-order-ask">
              {spreadPrices ? spreadPrices.ask.toFixed(2) : '-'}
            </span>
            <span className="roll-order-label">中間價</span>
            <span className="roll-order-value roll-order-mid">
              {spreadPrices ? spreadPrices.mid.toFixed(2) : '-'}
            </span>
            <span className="roll-order-label">限價</span>
            <div className="roll-limit-wrapper" ref={limitInputRef}>
              <input
                type="text"
                className="roll-order-input"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="0.00"
                style={
                  spreadPrices
                    ? limitPrice === spreadPrices.bid.toFixed(2)
                      ? { borderColor: '#22c55e', color: '#15803d' }
                      : limitPrice === spreadPrices.ask.toFixed(2)
                        ? { borderColor: '#ef4444', color: '#b91c1c' }
                        : limitPrice === spreadPrices.mid.toFixed(2)
                          ? { borderColor: '#f59e0b', color: '#b45309' }
                          : {}
                    : {}
                }
              />
            </div>

            {/* Selected contract summary */}
            {targetExpiry && targetStrike !== null && targetRight !== null && (
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#333', fontWeight: 500 }}>
                {positions.length > 0 && positions[0].quantity < 0 ? (
                  <span style={{ color: '#b91c1c', marginRight: 6 }}>賣出</span>
                ) : (
                  <span style={{ color: '#15803d', marginRight: 6 }}>買入</span>
                )}{' '}
                {symbol} {formatExpiry(targetExpiry)} {Number.isInteger(targetStrike) ? targetStrike : targetStrike.toFixed(1)} {targetRight === 'C' ? 'CALL' : 'PUT'}
              </span>
            )}
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
