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

interface OptionOrderDialogProps {
    open: boolean
    onClose: () => void
    accounts: AccountData[]
    positions: PositionData[]
    /** Pre-fill symbol when opened from a context (e.g. clicking a symbol) */
    initialSymbol?: string
}

function formatExpiry(expiry: string): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const year = expiry.substring(2, 4)
    const month = months[parseInt(expiry.substring(4, 6)) - 1]
    const day = parseInt(expiry.substring(6, 8), 10)
    return `${month}${day} '${year}`
}

const formatPrice = (v: number): string => (v > 0 ? v.toFixed(2) : '-')
const formatDelta = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return '-'
    return v.toFixed(3)
}

export default function OptionOrderDialog({
    open,
    onClose,
    accounts,
    positions,
    initialSymbol = 'QQQ'
}: OptionOrderDialogProps): React.JSX.Element | null {

    // ── Symbol ──────────────────────────────────────────────────────────────
    const [symbol, setSymbol] = useState(initialSymbol)
    const [symbolInput, setSymbolInput] = useState(initialSymbol)

    // ── Chain state ─────────────────────────────────────────────────────────
    const [chainParams, setChainParams] = useState<OptionChainParams[]>([])
    const [loadingChain, setLoadingChain] = useState(false)

    const [allGreeks, setAllGreeks] = useState<OptionGreek[]>([])
    const [errorMsg, setErrorMsg] = useState('')
    const [stockPrice, setStockPrice] = useState<number | null>(null)

    // ── Filters ──────────────────────────────────────────────────────────────
    const [selectedExpirations, setSelectedExpirations] = useState<string[]>([])
    const [expiryDropdownOpen, setExpiryDropdownOpen] = useState(false)
    const [selectedStrikes, setSelectedStrikes] = useState<number[]>([])
    const [strikeDropdownOpen, setStrikeDropdownOpen] = useState(false)
    const [chainHidden, setChainHidden] = useState(false)

    const fetchedExpiriesRef = useRef<Set<string>>(new Set())
    const fetchedStrikesRef = useRef<Set<number>>(new Set())
    const strikeDropdownRef = useRef<HTMLDivElement>(null)
    const strikeScrolledRef = useRef(false)
    const dialogBodyRef = useRef<HTMLDivElement>(null)
    const lastStrikeCenterRef = useRef<number | null>(null)
    const userModifiedStrikesRef = useRef(false)

    // ── Order selection ──────────────────────────────────────────────────────
    const [selExpiry, setSelExpiry] = useState('')
    const [selStrike, setSelStrike] = useState<number | null>(null)
    const [selRight, setSelRight] = useState<'C' | 'P' | null>(null)
    const [action, setAction] = useState<'BUY' | 'SELL'>('SELL')
    const [actionDropdownOpen, setActionDropdownOpen] = useState(false)

    // ── Limit price ──────────────────────────────────────────────────────────
    const [limitPrice, setLimitPrice] = useState('')
    const [limitDropdownOpen, setLimitDropdownOpen] = useState(false)
    const limitInputRef = useRef<HTMLInputElement>(null)
    const limitDropdownRef = useRef<HTMLDivElement>(null)

    // ── Account quantities ───────────────────────────────────────────────────
    const [qtys, setQtys] = useState<Record<string, string>>({})
    const [checkedAccounts, setCheckedAccounts] = useState<Record<string, boolean>>({})
    const [orderStatuses, setOrderStatuses] = useState<Record<string, string>>({})

    // ── Submit ───────────────────────────────────────────────────────────────
    const [submitting, setSubmitting] = useState(false)
    const [orderSubmitted, setOrderSubmitted] = useState(false)

    // ── Reset on open ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return
        const sym = initialSymbol
        setSymbol(sym)
        setSymbolInput(sym)
        setSelExpiry('')
        setSelStrike(null)
        setSelRight(null)
        setLimitPrice('')
        setLimitDropdownOpen(false)
        setErrorMsg('')
        setAction('SELL')
        const initQty: Record<string, string> = {}
        accounts.forEach(a => { initQty[a.accountId] = '' })
        setQtys(initQty)
        setCheckedAccounts({})
        setOrderStatuses({})
        setOrderSubmitted(false)
        if (sym) {
            // triggerFetch internally checks if symbol changed before clearing data
            setTimeout(() => triggerFetch(sym), 0)
        } else {
            setChainParams([])
            setAllGreeks([])
            setSelectedExpirations([])
            setSelectedStrikes([])
            fetchedExpiriesRef.current = new Set()
            fetchedStrikesRef.current = new Set()
            setStockPrice(null)
            lastStrikeCenterRef.current = null
        }
    }, [open])

    // ── Fetch chain when symbol changes ──────────────────────────────────────
    const fetchedSymbolRef = useRef('')
    const triggerFetch = useCallback((sym: string) => {
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

        window.ibApi.getStockQuote(sym).then(q => {
            const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
            if (price) setStockPrice(price)
        }).catch(() => { })

        window.ibApi.getOptionChain(sym).then(params => {
            setChainParams(params)
            if (params.length === 0) setErrorMsg('未找到期權鏈資料')
        }).catch((err: unknown) => {
            setErrorMsg(`查詢失敗: ${err instanceof Error ? err.message : String(err)}`)
        }).finally(() => setLoadingChain(false))
    }, [])

    // ── Available expirations / strikes ──────────────────────────────────────
    const availableExpirations = useMemo(() => {
        const set = new Set<string>()
        chainParams.forEach(p => p.expirations.forEach(e => set.add(e)))
        return Array.from(set).sort()
    }, [chainParams])

    const availableStrikes = useMemo(() => {
        const set = new Set<number>()
        chainParams.forEach(p => p.strikes.forEach(s => set.add(s)))
        return Array.from(set).sort((a, b) => a - b)
    }, [chainParams])

    // ── Auto-select first 3 expirations ──────────────────────────────────────
    useEffect(() => {
        if (availableExpirations.length > 0 && selectedExpirations.length === 0) {
            setSelectedExpirations(availableExpirations.slice(0, 3))
        }
    }, [availableExpirations])

    // ── Auto-select ±5 strikes around stock price ─────────────────────────
    useEffect(() => {
        if (availableStrikes.length === 0) return
        if (userModifiedStrikesRef.current) return
        if (stockPrice !== null) {
            // Only re-center if price moved to a different integer level
            const rounded = Math.round(stockPrice)
            if (lastStrikeCenterRef.current === rounded && selectedStrikes.length > 0) return
            lastStrikeCenterRef.current = rounded
            const idx = availableStrikes.findIndex(s => s >= stockPrice)
            const center = idx === -1 ? availableStrikes.length - 1 : idx
            const start = Math.max(0, center - 5)
            const end = Math.min(availableStrikes.length, center + 6)
            setSelectedStrikes(availableStrikes.slice(start, end).slice(0, 10))
        } else if (selectedStrikes.length === 0) {
            // fallback: pick 10 from the middle
            const mid = Math.floor(availableStrikes.length / 2)
            const start = Math.max(0, mid - 5)
            const end = Math.min(availableStrikes.length, start + 10)
            setSelectedStrikes(availableStrikes.slice(start, end))
        }
    }, [availableStrikes, stockPrice])

    const displayExpirations = useMemo(
        () => selectedExpirations.filter(e => availableExpirations.includes(e)).sort(),
        [selectedExpirations, availableExpirations]
    )
    const displayStrikes = useMemo(
        () => selectedStrikes.filter(s => availableStrikes.includes(s)).sort((a, b) => a - b),
        [selectedStrikes, availableStrikes]
    )

    const toggleExpiry = useCallback((exp: string) => {
        setSelectedExpirations(prev => {
            if (prev.includes(exp)) return prev.filter(e => e !== exp)
            if (prev.length >= 5) {
                const sorted = [...prev].sort()
                const drop = exp < sorted[0] ? sorted[sorted.length - 1] : sorted[0]
                return [...prev.filter(e => e !== drop), exp]
            }
            return [...prev, exp]
        })
    }, [])

    const toggleStrike = useCallback((strike: number) => {
        userModifiedStrikesRef.current = true
        // Preserve dialog body scroll position across the re-render
        const scrollTop = dialogBodyRef.current?.scrollTop ?? 0
        setSelectedStrikes(prev => {
            if (prev.includes(strike)) return prev.filter(s => s !== strike)
            if (prev.length >= 10) {
                const drop = strike < Math.min(...prev) ? Math.max(...prev) : Math.min(...prev)
                return [...prev.filter(s => s !== drop), strike]
            }
            return [...prev, strike]
        })
        requestAnimationFrame(() => {
            if (dialogBodyRef.current) dialogBodyRef.current.scrollTop = scrollTop
        })
    }, [])

    // ── Fetch greeks incrementally ────────────────────────────────────────────
    useEffect(() => {
        if (displayStrikes.length === 0 || !symbol) return
        const newExpiries = displayExpirations.filter(e => !fetchedExpiriesRef.current.has(e))
        const newStrikes = displayStrikes.filter(s => !fetchedStrikesRef.current.has(s))
        const fetchPairs: { exp: string; strikes: number[] }[] = []

        if (newExpiries.length > 0) {
            newExpiries.forEach(exp => {
                fetchPairs.push({ exp, strikes: displayStrikes })
                fetchedExpiriesRef.current.add(exp)
            })
        }
        if (newStrikes.length > 0) {
            const existingExpiries = displayExpirations.filter(e => !newExpiries.includes(e))
            existingExpiries.forEach(exp => fetchPairs.push({ exp, strikes: newStrikes }))
            newStrikes.forEach(s => fetchedStrikesRef.current.add(s))
        }
        displayStrikes.forEach(s => fetchedStrikesRef.current.add(s))

        if (fetchPairs.length === 0) return

        fetchPairs.forEach(({ exp, strikes }) => {
            window.ibApi.getOptionGreeks(symbol, exp, strikes).then(greeks => {
                setAllGreeks(prev => [...prev, ...greeks])
            }).catch(() => { })
        })
    }, [displayExpirations, displayStrikes, symbol])

    // ── Auto-refresh greeks ───────────────────────────────────────────────────
    const refreshingRef = useRef(false)
    useEffect(() => {
        if (!symbol || displayStrikes.length === 0 || displayExpirations.length === 0) return
        let cancelled = false
        async function refresh(): Promise<void> {
            if (refreshingRef.current || cancelled) return
            refreshingRef.current = true
            try {
                await Promise.all(displayExpirations.map(exp =>
                    window.ibApi.getOptionGreeks(symbol, exp, displayStrikes).then(greeks => {
                        if (cancelled || greeks.length === 0) return
                        setAllGreeks(prev => {
                            const mergeGreek = (old: OptionGreek, n: OptionGreek): OptionGreek => ({
                                ...old,
                                bid: n.bid > 0 ? n.bid : old.bid,
                                ask: n.ask > 0 ? n.ask : old.ask,
                                last: n.last > 0 ? n.last : old.last,
                                delta: n.delta !== 0 ? n.delta : old.delta,
                                gamma: n.gamma !== 0 ? n.gamma : old.gamma,
                                theta: n.theta !== 0 ? n.theta : old.theta,
                                vega: n.vega !== 0 ? n.vega : old.vega,
                                impliedVol: n.impliedVol > 0 ? n.impliedVol : old.impliedVol,
                            })
                            const incoming = new Map<string, OptionGreek>(greeks.map(g => [`${g.expiry}_${g.strike}_${g.right}`, g]))
                            const existingKeys = new Set(prev.map(g => `${g.expiry}_${g.strike}_${g.right}`))
                            const updated = prev.map(g => {
                                const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`)
                                return n ? mergeGreek(g, n) : g
                            })
                            const newEntries = greeks.filter(g => !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`) && (g.bid > 0 || g.ask > 0 || g.delta !== 0))
                            return newEntries.length > 0 ? [...updated, ...newEntries] : updated
                        })
                    })
                ))
            } catch { /* ignore */ } finally {
                refreshingRef.current = false
            }
        }
        const id = setInterval(() => {
            refresh()
            // Also refresh stock price so strike filter stays centered
            window.ibApi.getStockQuote(symbol).then(q => {
                const price = q.last > 0 ? q.last : q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null
                if (price) setStockPrice(price)
            }).catch(() => { })
        }, 3000)
        return () => { cancelled = true; clearInterval(id) }
    }, [symbol, displayExpirations, displayStrikes])

    // ── Group greeks by expiry ────────────────────────────────────────────────
    const greeksByExpiry = useMemo(() => {
        const map = new Map<string, Map<string, OptionGreek>>()
        allGreeks.forEach(g => {
            if (!map.has(g.expiry)) map.set(g.expiry, new Map())
            map.get(g.expiry)!.set(`${g.strike}_${g.right}`, g)
        })
        return map
    }, [allGreeks])

    // ── Selected greek ────────────────────────────────────────────────────────
    const selGreek = useMemo(() => {
        if (!selExpiry || selStrike === null || selRight === null) return undefined
        return allGreeks.find(g => g.expiry === selExpiry && g.strike === selStrike && g.right === selRight)
    }, [allGreeks, selExpiry, selStrike, selRight])

    // ── Price options for dropdown ────────────────────────────────────────────
    const priceOptions = useMemo(() => {
        if (!selGreek) return []
        const lo = Math.min(selGreek.bid, selGreek.ask) - 0.30
        const hi = Math.max(selGreek.bid, selGreek.ask) + 0.30
        const steps = Math.min(Math.round((hi - lo) / 0.01) + 1, 200)
        const opts: string[] = []
        for (let i = 0; i < steps; i++) opts.push((hi - i * 0.01).toFixed(2))
        return opts
    }, [selGreek])

    // ── Auto-fill mid price when selection changes ────────────────────────────
    useEffect(() => {
        if (selGreek && selGreek.bid > 0 && selGreek.ask > 0) {
            setLimitPrice(((selGreek.bid + selGreek.ask) / 2).toFixed(2))
        }
    }, [selGreek])

    // ── Scroll limit dropdown to mid on open ─────────────────────────────────
    useEffect(() => {
        if (limitDropdownOpen && limitDropdownRef.current && selGreek) {
            const midVal = ((selGreek.bid + selGreek.ask) / 2).toFixed(2)
            const midEl = limitDropdownRef.current.querySelector(`[data-price="${midVal}"]`) as HTMLElement | null
            if (midEl) midEl.scrollIntoView({ block: 'center' })
        }
    }, [limitDropdownOpen, selGreek])

    // ── Close limit dropdown on outside click ─────────────────────────────────
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

    const dataReady = displayExpirations.length > 0 && displayStrikes.length > 0

    const canSubmit = selExpiry && selStrike !== null && selRight !== null && limitPrice
        && Object.entries(qtys).some(([, q]) => q !== '' && parseInt(q) > 0)

    if (!open) return null

    const handleSelect = (expiry: string, strike: number, right: 'C' | 'P'): void => {
        setSelExpiry(expiry)
        setSelStrike(strike)
        setSelRight(right)
    }

    const handleSubmit = async (): Promise<void> => {
        if (!selExpiry || selStrike === null || selRight === null || !limitPrice) return
        const accountQuantities: Record<string, number> = {}
        Object.entries(qtys).forEach(([acctId, q]) => {
            if (checkedAccounts[acctId] !== true) return
            const n = parseInt(q)
            if (!isNaN(n) && n > 0) accountQuantities[acctId] = n
        })
        if (Object.keys(accountQuantities).length === 0) return
        setSubmitting(true)
        // Mark submitting accounts
        const pending: Record<string, string> = {}
        Object.keys(accountQuantities).forEach(id => { pending[id] = '送出中...' })
        setOrderStatuses(prev => ({ ...prev, ...pending }))
        try {
            const results = await window.ibApi.placeOptionBatchOrders(
                {
                    symbol,
                    expiry: selExpiry,
                    strike: selStrike,
                    right: selRight,
                    action,
                    limitPrice: parseFloat(limitPrice),
                    outsideRth: true
                },
                accountQuantities
            )
            const statusMap: Record<string, string> = {}
            results.forEach(r => { statusMap[r.account] = '已送出' })
            setOrderStatuses(prev => ({ ...prev, ...statusMap }))
        } catch (err: unknown) {
            const errMap: Record<string, string> = {}
            Object.keys(accountQuantities).forEach(id => { errMap[id] = '失敗' })
            setOrderStatuses(prev => ({ ...prev, ...errMap }))
        } finally {
            setSubmitting(false)
            setOrderSubmitted(true)
        }
    }

    const sortedAccounts = [...accounts].sort((a, b) => (b.netLiquidation || 0) - (a.netLiquidation || 0))
    const getAlias = (acctId: string): string => accounts.find(a => a.accountId === acctId)?.alias || acctId

    return (
        <div className="roll-dialog-overlay" onMouseDown={onClose}>
            <div className="roll-dialog" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="roll-dialog-header">
                    <h3>期權下單</h3>
                    <button className="roll-dialog-close" onClick={onClose}>✕</button>
                </div>

                <div className="roll-dialog-body" ref={dialogBodyRef}>

                    {/* Symbol + Action + Filters — single combined row */}
                    <div className="roll-selectors-row" style={{ marginBottom: 8, gap: 8 }}>

                        <input
                            className="roll-order-input"
                            style={{ width: 80, textTransform: 'uppercase', textAlign: 'center' }}
                            value={symbolInput}
                            onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    setSymbol(symbolInput)
                                    triggerFetch(symbolInput)
                                }
                            }}
                            placeholder="標的"
                        />
                        <button
                            className="roll-expiry-dropdown-btn"
                            onClick={() => { setSymbol(symbolInput); triggerFetch(symbolInput) }}
                            disabled={loadingChain}
                        >
                            {loadingChain ? '載入中...' : '查詢'}
                        </button>

                        <div className="roll-expiry-selector">
                            <button
                                className="roll-expiry-dropdown-btn"
                                onClick={() => setActionDropdownOpen(v => !v)}
                                style={{
                                    fontWeight: 600,
                                    color: action === 'BUY' ? '#15803d' : '#b91c1c',
                                    background: action === 'BUY' ? '#dcfce7' : '#fee2e2',
                                    borderColor: action === 'BUY' ? '#86efac' : '#fca5a5'
                                }}
                            >
                                {action === 'BUY' ? '買入' : '賣出'} ▾
                            </button>
                            {actionDropdownOpen && (
                                <>
                                    <div className="roll-expiry-backdrop" onClick={(e) => { e.stopPropagation(); setActionDropdownOpen(false) }} />
                                    <div className="roll-expiry-dropdown" style={{ minWidth: 80 }}>
                                        <div
                                            className={`roll-expiry-option${action === 'BUY' ? ' checked' : ''}`}
                                            onClick={() => { setAction('BUY'); setActionDropdownOpen(false) }}
                                            style={{ cursor: 'pointer', padding: '6px 12px', fontWeight: 600, color: '#15803d' }}
                                        >
                                            買入
                                        </div>
                                        <div
                                            className={`roll-expiry-option${action === 'SELL' ? ' checked' : ''}`}
                                            onClick={() => { setAction('SELL'); setActionDropdownOpen(false) }}
                                            style={{ cursor: 'pointer', padding: '6px 12px', fontWeight: 600, color: '#b91c1c' }}
                                        >
                                            賣出
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {stockPrice !== null && (
                            <span className="roll-stock-price">股價 {stockPrice.toFixed(2)}</span>
                        )}
                        {/* Filter buttons pushed to the right */}
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {dataReady && availableExpirations.length > 0 && (
                                <div className="roll-expiry-selector">
                                    <button
                                        className="roll-expiry-dropdown-btn"
                                        onClick={() => setExpiryDropdownOpen(v => !v)}
                                    >
                                        最後交易日 ▾ <span className="roll-expiry-count">{selectedExpirations.length}</span>
                                    </button>
                                    {expiryDropdownOpen && (
                                        <>
                                            <div className="roll-expiry-backdrop" onClick={(e) => { e.stopPropagation(); setExpiryDropdownOpen(false) }} />
                                            <div className="roll-expiry-dropdown" style={{ right: 0, left: 'auto' }}>
                                                {availableExpirations.map(exp => (
                                                    <label key={exp} className={`roll-expiry-option ${selectedExpirations.includes(exp) ? 'checked' : ''}`}>
                                                        <input type="checkbox" checked={selectedExpirations.includes(exp)} onChange={() => toggleExpiry(exp)} />
                                                        {formatExpiry(exp)}
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            {dataReady && availableStrikes.length > 0 && (
                                <div className="roll-expiry-selector">
                                    <button
                                        className="roll-expiry-dropdown-btn"
                                        onClick={() => { strikeScrolledRef.current = false; setStrikeDropdownOpen(v => !v) }}
                                    >
                                        行使價 ▾ <span className="roll-expiry-count">{selectedStrikes.length}</span>
                                    </button>
                                    {strikeDropdownOpen && (
                                        <>
                                            <div className="roll-expiry-backdrop" onClick={(e) => { e.stopPropagation(); setStrikeDropdownOpen(false) }} />
                                            <div className="roll-expiry-dropdown" ref={(el) => {
                                                (strikeDropdownRef as React.MutableRefObject<HTMLDivElement | null>).current = el
                                                if (el && !strikeScrolledRef.current && selectedStrikes.length > 0) {
                                                    strikeScrolledRef.current = true
                                                    const sortedSel = [...selectedStrikes].sort((a, b) => a - b)
                                                    const firstIdx = availableStrikes.indexOf(sortedSel[0])
                                                    if (firstIdx > 0) {
                                                        const label = el.children[firstIdx] as HTMLElement
                                                        if (label) el.scrollTop = label.offsetTop
                                                    }
                                                }
                                            }} style={{ right: 0, left: 'auto' }}>
                                                {availableStrikes.map(strike => (
                                                    <label key={strike} className={`roll-expiry-option ${selectedStrikes.includes(strike) ? 'checked' : ''}`}>
                                                        <input type="checkbox" checked={selectedStrikes.includes(strike)} onChange={() => toggleStrike(strike)} />
                                                        {strike}
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            {dataReady && (
                                <button className="roll-expiry-dropdown-btn" onClick={() => setChainHidden(v => !v)}>
                                    {chainHidden ? '顯示期權鏈 ▼' : '隱藏期權鏈 ▲'}
                                </button>
                            )}

                        </div>
                    </div>

                    {errorMsg && <div className="roll-dialog-error">{errorMsg}</div>}


                    {/* Option chain */}
                    {(loadingChain || chainParams.length > 0) && !chainHidden && (
                        <div className="roll-chain-multi">
                            <table className="roll-chain-table">
                                <thead>
                                    <tr>
                                        <th colSpan={4} className="roll-chain-side-header roll-chain-call-header">CALL</th>
                                        <th className="roll-chain-desc-header"></th>
                                        <th colSpan={4} className="roll-chain-side-header roll-chain-put-header">PUT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadingChain && (<>
                                        <tr className="roll-chain-expiry-row">
                                            <td>買價</td><td>賣價</td><td>最後價</td><td>Delta</td>
                                            <td className="roll-chain-expiry-label">載入中...</td>
                                            <td>買價</td><td>賣價</td><td>最後價</td><td>Delta</td>
                                        </tr>
                                        {Array.from({ length: 10 }, (_, i) => (
                                            <tr key={`loading-${i}`}>
                                                <td className="roll-chain-cell roll-chain-call">-</td>
                                                <td className="roll-chain-cell roll-chain-call">-</td>
                                                <td className="roll-chain-cell roll-chain-call">-</td>
                                                <td className="roll-chain-cell roll-chain-call">-</td>
                                                <td className="roll-chain-strike">-</td>
                                                <td className="roll-chain-cell roll-chain-put">-</td>
                                                <td className="roll-chain-cell roll-chain-put">-</td>
                                                <td className="roll-chain-cell roll-chain-put">-</td>
                                                <td className="roll-chain-cell roll-chain-put">-</td>
                                            </tr>
                                        ))}
                                    </>)}
                                    {!loadingChain && displayExpirations.map(expiry => {
                                        const gMap = greeksByExpiry.get(expiry)
                                        return [
                                            <tr key={`hdr-${expiry}`} className="roll-chain-expiry-row">
                                                <td>買價</td><td>賣價</td><td>最後價</td><td>Delta</td>
                                                <td className="roll-chain-expiry-label">{formatExpiry(expiry)}</td>
                                                <td>買價</td><td>賣價</td><td>最後價</td><td>Delta</td>
                                            </tr>,
                                            ...displayStrikes.map(strike => {
                                                const cg = gMap?.get(`${strike}_C`)
                                                const pg = gMap?.get(`${strike}_P`)
                                                const callSel = selExpiry === expiry && selStrike === strike && selRight === 'C'
                                                const putSel = selExpiry === expiry && selStrike === strike && selRight === 'P'
                                                return (
                                                    <tr key={`${expiry}-${strike}`}>
                                                        <td className={`roll-chain-cell roll-chain-call${callSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'C')}>{cg ? formatPrice(cg.bid) : '-'}</td>
                                                        <td className={`roll-chain-cell roll-chain-call${callSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'C')}>{cg ? formatPrice(cg.ask) : '-'}</td>
                                                        <td className={`roll-chain-cell roll-chain-call${callSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'C')}>{cg ? formatPrice(cg.last) : '-'}</td>
                                                        <td className={`roll-chain-cell roll-chain-call${callSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'C')}>{cg ? formatDelta(cg.delta) : '-'}</td>
                                                        <td className="roll-chain-strike">{strike}</td>
                                                        <td className={`roll-chain-cell roll-chain-put${putSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'P')}>{pg ? formatPrice(pg.bid) : '-'}</td>
                                                        <td className={`roll-chain-cell roll-chain-put${putSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'P')}>{pg ? formatPrice(pg.ask) : '-'}</td>
                                                        <td className={`roll-chain-cell roll-chain-put${putSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'P')}>{pg ? formatPrice(pg.last) : '-'}</td>
                                                        <td className={`roll-chain-cell roll-chain-put${putSel ? ' roll-chain-selected' : ''}`} onClick={() => handleSelect(expiry, strike, 'P')}>{pg ? formatDelta(pg.delta) : '-'}</td>
                                                    </tr>
                                                )
                                            })
                                        ]
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Limit price row */}
                    <div className="roll-order-section">
                        <span className="roll-order-label">買價</span>
                        <button
                            className="roll-order-price-btn roll-order-bid"
                            disabled={!selGreek}
                            onClick={() => selGreek && setLimitPrice(selGreek.bid.toFixed(2))}
                        >
                            {selGreek ? formatPrice(selGreek.bid) : '-'}
                        </button>
                        <span className="roll-order-label">賣價</span>
                        <button
                            className="roll-order-price-btn roll-order-ask"
                            disabled={!selGreek}
                            onClick={() => selGreek && setLimitPrice(selGreek.ask.toFixed(2))}
                        >
                            {selGreek ? formatPrice(selGreek.ask) : '-'}
                        </button>
                        <span className="roll-order-label">限價</span>
                        <div className="roll-limit-wrapper" ref={limitInputRef}>
                            <input
                                type="text"
                                className="roll-order-input"
                                value={limitPrice}
                                onChange={e => setLimitPrice(e.target.value)}
                                onFocus={() => priceOptions.length > 0 && setLimitDropdownOpen(true)}
                                onClick={() => priceOptions.length > 0 && setLimitDropdownOpen(true)}
                                placeholder="0.00"
                                style={selGreek ? (
                                    limitPrice === selGreek.bid.toFixed(2)
                                        ? { borderColor: '#22c55e', color: '#15803d' }
                                        : limitPrice === selGreek.ask.toFixed(2)
                                            ? { borderColor: '#ef4444', color: '#b91c1c' }
                                            : {}
                                ) : {}}
                            />
                            <span className="roll-limit-arrow" onClick={() => priceOptions.length > 0 && setLimitDropdownOpen(v => !v)}>▾</span>
                            {limitDropdownOpen && priceOptions.length > 0 && createPortal(
                                <div
                                    className="roll-limit-dropdown"
                                    ref={limitDropdownRef}
                                    style={{
                                        position: 'fixed',
                                        bottom: window.innerHeight - (limitInputRef.current?.getBoundingClientRect().top ?? 0) + 2,
                                        left: limitInputRef.current?.getBoundingClientRect().left ?? 0,
                                        minWidth: limitInputRef.current?.getBoundingClientRect().width ?? 120,
                                    }}
                                >
                                    {priceOptions.map(opt => {
                                        const bidVal = selGreek ? selGreek.bid.toFixed(2) : ''
                                        const askVal = selGreek ? selGreek.ask.toFixed(2) : ''
                                        const midVal = selGreek ? ((selGreek.bid + selGreek.ask) / 2).toFixed(2) : ''
                                        return (
                                            <div
                                                key={opt}
                                                data-price={opt}
                                                className={`roll-limit-option ${opt === limitPrice ? 'selected' : ''}`}
                                                onMouseDown={() => { setLimitPrice(opt); setLimitDropdownOpen(false) }}
                                            >
                                                {opt}
                                                {opt === bidVal && <span className="roll-limit-tag roll-limit-tag-bid"> (買價)</span>}
                                                {opt === midVal && opt !== bidVal && opt !== askVal && <span className="roll-limit-tag roll-limit-tag-mid"> (中間價)</span>}
                                                {opt === askVal && <span className="roll-limit-tag roll-limit-tag-ask"> (賣價)</span>}
                                            </div>
                                        )
                                    })}
                                </div>,
                                document.body
                            )}
                        </div>

                        {/* Selected contract summary */}
                        {selExpiry && selStrike !== null && selRight !== null && (
                            <span style={{ marginLeft: 12, fontSize: 13, color: '#333', fontWeight: 500 }}>
                                {action === 'BUY'
                                    ? <span style={{ color: '#15803d', marginRight: 6 }}>買入</span>
                                    : <span style={{ color: '#b91c1c', marginRight: 6 }}>賣出</span>
                                }
                                {' '}{symbol} {formatExpiry(selExpiry)} {selStrike} {selRight === 'C' ? 'CALL' : 'PUT'}
                            </span>
                        )}
                    </div>

                    {/* Account quantity table */}
                    <div className="roll-dialog-table-wrapper">
                        <table className="roll-dialog-table roll-positions-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 30 }}></th>
                                    <th style={{ width: 200 }}>帳戶</th>
                                    <th style={{ width: 90, textAlign: 'center' }}>現金</th>
                                    <th style={{ width: 90, textAlign: 'center' }}>潛在融資</th>
                                    <th style={{ width: 90, textAlign: 'center' }}>新潛在融資</th>
                                    <th style={{ width: 90, textAlign: 'center' }}>成本基礎</th>
                                    <th style={{ textAlign: 'center', width: 90 }}>口數</th>
                                    <th style={{ textAlign: 'center', width: 70 }}>狀態</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedAccounts.map((acct) => {
                                    const qty = qtys[acct.accountId] ?? ''
                                    const qtyNum = parseInt(qty) || 0
                                    return (
                                        <tr key={acct.accountId} style={{ height: 36 }}>
                                            <td style={{ textAlign: 'center', width: '30px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={checkedAccounts[acct.accountId] === true}
                                                    onChange={e => setCheckedAccounts(prev => ({ ...prev, [acct.accountId]: e.target.checked }))}
                                                    style={{ cursor: 'pointer' }}
                                                />
                                            </td>
                                            <td
                                                style={{ fontWeight: 'bold', overflow: 'visible', whiteSpace: 'nowrap', cursor: 'pointer' }}
                                                onClick={() => setCheckedAccounts(prev => ({ ...prev, [acct.accountId]: !prev[acct.accountId] }))}
                                            >{getAlias(acct.accountId)}</td>
                                            <td style={{ fontSize: 13, whiteSpace: 'nowrap', textAlign: 'center', color: acct.totalCashValue < 0 ? '#8b1a1a' : undefined }}>
                                                {acct.totalCashValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                            </td>
                                            <td style={{ fontSize: 13, whiteSpace: 'nowrap', textAlign: 'center' }}>
                                                {(() => {
                                                    if (!acct.netLiquidation || acct.netLiquidation <= 0) return '-'
                                                    const shortPutNotional = positions
                                                        .filter(p => p.account === acct.accountId && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT') && p.quantity < 0)
                                                        .reduce((sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity), 0)
                                                    return ((acct.grossPositionValue + shortPutNotional) / acct.netLiquidation).toFixed(2)
                                                })()}
                                            </td>
                                            <td style={{ fontSize: 13, whiteSpace: 'nowrap', textAlign: 'center' }}>
                                                {(() => {
                                                    if (!acct.netLiquidation || acct.netLiquidation <= 0 || !selStrike || qtyNum <= 0) return '-'
                                                    const shortPutNotional = positions
                                                        .filter(p => p.account === acct.accountId && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT') && p.quantity < 0)
                                                        .reduce((sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity), 0)
                                                    let newShortPutNotional = shortPutNotional
                                                    let newGrossPositionValue = acct.grossPositionValue
                                                    if (action === 'SELL' && selRight === 'P') {
                                                        newShortPutNotional += selStrike * 100 * qtyNum
                                                    } else if (action === 'BUY') {
                                                        const price = parseFloat(limitPrice) || 0
                                                        newGrossPositionValue += price * 100 * qtyNum
                                                    }
                                                    return ((newGrossPositionValue + newShortPutNotional) / acct.netLiquidation).toFixed(2)
                                                })()}
                                            </td>
                                            <td style={{ fontSize: 13, whiteSpace: 'nowrap', textAlign: 'center' }}>
                                                {(() => {
                                                    const price = parseFloat(limitPrice)
                                                    if (!price || price <= 0) return '-'
                                                    const cost = price * 100
                                                    return action === 'SELL' ? (-cost).toFixed(2) : cost.toFixed(2)
                                                })()}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {checkedAccounts[acct.accountId] === true && (
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={qty}
                                                        onChange={e => setQtys(prev => ({ ...prev, [acct.accountId]: e.target.value }))}
                                                        className="input-field input-small"
                                                        style={{ height: 24, padding: '2px 8px', textAlign: 'center' }}
                                                    />
                                                )}
                                            </td>
                                            <td style={{
                                                textAlign: 'center', fontSize: 12, fontWeight: 500,
                                                color: orderStatuses[acct.accountId] === '已送出' ? '#15803d'
                                                    : orderStatuses[acct.accountId] === '失敗' ? '#b91c1c'
                                                        : orderStatuses[acct.accountId] === '送出中...' ? '#b45309'
                                                            : '#666'
                                            }}>
                                                {orderStatuses[acct.accountId] || ''}
                                            </td>

                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Footer */}
                <div className="roll-dialog-footer">
                    <button className="roll-dialog-cancel" onClick={() => {
                        setSelExpiry('')
                        setSelStrike(null)
                        setSelRight(null)
                        setLimitPrice('')
                        const initQty: Record<string, string> = {}
                        accounts.forEach(a => { initQty[a.accountId] = '' })
                        setQtys(initQty)
                        setCheckedAccounts({})
                        setOrderStatuses({})
                        setOrderSubmitted(false)
                    }}>取消</button>
                    <button
                        className="roll-dialog-confirm"
                        disabled={orderSubmitted ? false : (!canSubmit || submitting)}
                        onClick={orderSubmitted ? () => {
                            setSelExpiry('')
                            setSelStrike(null)
                            setSelRight(null)
                            setLimitPrice('')
                            const initQty: Record<string, string> = {}
                            accounts.forEach(a => { initQty[a.accountId] = '' })
                            setQtys(initQty)
                            setCheckedAccounts({})
                            setOrderStatuses({})
                            setOrderSubmitted(false)
                        } : handleSubmit}
                    >
                        {submitting ? '下單中...' : orderSubmitted ? '重新下單' : selExpiry && selStrike !== null && selRight !== null ? `確認下單 (${action === 'BUY' ? '買' : '賣'}) ${symbol} ${formatExpiry(selExpiry)} ${selStrike}${selRight === 'C' ? 'C' : 'P'}` : '確認下單'}
                    </button>
                </div>
            </div>
        </div>
    )
}
