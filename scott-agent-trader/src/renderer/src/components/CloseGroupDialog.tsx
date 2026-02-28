import React from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatOptionLabel(
    symbol: string,
    expiry?: string,
    strike?: number,
    right?: string
): string {
    if (!expiry || strike === undefined || !right) return symbol
    const yy = expiry.slice(2, 4)
    const m = MONTHS[parseInt(expiry.slice(4, 6), 10) - 1] || expiry.slice(4, 6)
    const d = parseInt(expiry.slice(6, 8), 10)
    const r = right === 'C' || right === 'CALL' ? 'C' : 'P'
    return `${symbol} ${m}${d}'${yy} ${strike}${r}`
}

function optionKey(pos: PositionData): string {
    return `${pos.symbol}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`
}

interface CloseGroupDialogProps {
    open: boolean
    onClose: () => void
    selectedPositions: PositionData[]
    accounts: AccountData[]
    positions: PositionData[]
    quotes: Record<string, number>
}

interface OrderResult {
    orderId: number
    account: string
    status: string
    filled: number
    remaining: number
    avgFillPrice: number
    symbol: string
}

// ---- Stock types ----
interface StkPreviewRow {
    accountId: string
    alias: string
    type: 'STK'
    symbol: string
    action: 'SELL'
    qty: number
    price: number
}

// ---- Option types ----
interface OptPreviewRow {
    accountId: string
    alias: string
    type: 'OPT'
    optKey: string
    label: string
    symbol: string
    expiry: string
    strike: number
    right: 'C' | 'P'
    action: 'BUY' | 'SELL'
    qty: number
    price: number
}

type PreviewRow = StkPreviewRow | OptPreviewRow

export default function CloseGroupDialog({
    open,
    onClose,
    selectedPositions,
    accounts,
    positions: _positions,
    quotes
}: CloseGroupDialogProps): React.JSX.Element | null {
    const [submitting, setSubmitting] = useState(false)
    const [orderResults, setOrderResults] = useState<OrderResult[]>([])
    const [step, setStep] = useState<'preview' | 'confirm' | 'done'>('preview')
    const [confirmedRows, setConfirmedRows] = useState<PreviewRow[]>([])

    // Stock prices keyed by symbol
    const [stkPrices, setStkPrices] = useState<Record<string, string>>({})
    const [stkTifs, setStkTifs] = useState<Record<string, 'DAY' | 'GTC'>>({})
    const [stkOutsideRths, setStkOutsideRths] = useState<Record<string, boolean>>({})
    const [stkQuotes, setStkQuotes] = useState<Record<string, { bid: number; ask: number; last: number }>>({})
    const [stkQtyOverrides, setStkQtyOverrides] = useState<Record<string, number>>({})

    // Option prices keyed by optionKey
    const [optPrices, setOptPrices] = useState<Record<string, string>>({})
    const [optTifs, setOptTifs] = useState<Record<string, 'DAY' | 'GTC'>>({})
    const [optOutsideRths, setOptOutsideRths] = useState<Record<string, boolean>>({})
    const [optQuotes, setOptQuotes] = useState<Record<string, { bid: number; ask: number; last: number }>>({})
    const [optQtyOverrides, setOptQtyOverrides] = useState<Record<string, number>>({})

    // TIF dropdown
    const [tifOpen, setTifOpen] = useState<string | null>(null)

    // Split positions
    const stockPositions = useMemo(
        () => selectedPositions.filter((p) => p.secType === 'STK'),
        [selectedPositions]
    )
    const optionPositions = useMemo(
        () => selectedPositions.filter((p) => p.secType === 'OPT'),
        [selectedPositions]
    )

    // Unique stock symbols
    const stkSymbols = useMemo(() => {
        const s = new Set<string>()
        for (const p of stockPositions) s.add(p.symbol)
        return Array.from(s).sort()
    }, [stockPositions])

    // Unique option contracts
    const uniqueContracts = useMemo(() => {
        const map = new Map<string, { symbol: string; expiry: string; strike: number; right: string; label: string }>()
        for (const pos of optionPositions) {
            const key = optionKey(pos)
            if (!map.has(key)) {
                map.set(key, {
                    symbol: pos.symbol,
                    expiry: pos.expiry || '',
                    strike: pos.strike || 0,
                    right: pos.right || '',
                    label: formatOptionLabel(pos.symbol, pos.expiry, pos.strike, pos.right)
                })
            }
        }
        return Array.from(map.entries())
    }, [optionPositions])

    // Close TIF dropdowns
    useEffect(() => {
        const handler = (e: MouseEvent): void => {
            if ((e.target as HTMLElement).closest('.tif-dropdown')) return
            setTifOpen(null)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // Fetch stock quotes
    useEffect(() => {
        if (stkSymbols.length === 0) return
        const fetchAll = async (): Promise<void> => {
            for (const sym of stkSymbols) {
                try {
                    const q = await window.ibApi.getStockQuote(sym)
                    setStkQuotes((prev) => ({ ...prev, [sym]: q }))
                } catch { /* ignore */ }
            }
        }
        const t = setTimeout(fetchAll, 300)
        const i = setInterval(fetchAll, 5000)
        return () => { clearTimeout(t); clearInterval(i) }
    }, [stkSymbols])

    // Fetch option quotes
    useEffect(() => {
        if (uniqueContracts.length === 0) return
        const fetchAll = async (): Promise<void> => {
            for (const [, c] of uniqueContracts) {
                try {
                    const contracts = [{ symbol: c.symbol, expiry: c.expiry, strike: c.strike, right: c.right }]
                    const result = await window.ibApi.getOptionQuotes(contracts)
                    const key = `${c.symbol}|${c.expiry}|${c.strike}|${c.right}`
                    const priceVal = (Object.values(result)[0] as number) || 0
                    setOptQuotes((prev) => ({ ...prev, [key]: { bid: priceVal, ask: priceVal, last: priceVal } }))
                } catch { /* ignore */ }
            }
        }
        const t = setTimeout(fetchAll, 300)
        const i = setInterval(fetchAll, 5000)
        return () => { clearTimeout(t); clearInterval(i) }
    }, [uniqueContracts])

    // Auto-fill stock prices
    useEffect(() => {
        for (const sym of stkSymbols) {
            const lastPrice = quotes[sym] || 0
            if (lastPrice > 0 && !stkPrices[sym]) {
                setStkPrices((prev) => ({ ...prev, [sym]: lastPrice.toFixed(2) }))
            }
        }
    }, [stkSymbols, quotes]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-fill option prices
    useEffect(() => {
        for (const [key] of uniqueContracts) {
            const q = optQuotes[key]
            if (q && q.last > 0 && !optPrices[key]) {
                setOptPrices((prev) => ({ ...prev, [key]: q.last.toFixed(2) }))
            }
        }
    }, [uniqueContracts, optQuotes]) // eslint-disable-line react-hooks/exhaustive-deps

    // Listen for order status
    useEffect(() => {
        const unsub = window.ibApi.onOrderStatus((update: OrderResult) => {
            setOrderResults((prev) =>
                prev.map((r) =>
                    r.orderId === update.orderId
                        ? { ...r, ...update, account: r.account, symbol: r.symbol }
                        : r
                )
            )
        })
        return () => { unsub() }
    }, [])

    // Build preview rows
    const previewRows = useMemo((): PreviewRow[] => {
        const rows: PreviewRow[] = []

        // Stock rows
        for (const pos of stockPositions) {
            const overrideKey = `${pos.symbol}:${pos.account}`
            const qty = stkQtyOverrides[overrideKey] !== undefined ? stkQtyOverrides[overrideKey] : pos.quantity
            const price = parseFloat(stkPrices[pos.symbol] || '') || quotes[pos.symbol] || pos.avgCost
            const acct = accounts.find((a) => a.accountId === pos.account)
            rows.push({
                accountId: pos.account,
                alias: acct?.alias || pos.account,
                type: 'STK',
                symbol: pos.symbol,
                action: 'SELL',
                qty,
                price
            })
        }

        // Option rows
        for (const pos of optionPositions) {
            const key = optionKey(pos)
            const contract = uniqueContracts.find(([k]) => k === key)
            if (!contract) continue
            const [, c] = contract
            const overrideKey = `${key}:${pos.account}`
            const qty = optQtyOverrides[overrideKey] !== undefined
                ? optQtyOverrides[overrideKey]
                : Math.abs(pos.quantity)
            const price = parseFloat(optPrices[key] || '') || optQuotes[key]?.last || 0 || pos.avgCost
            const action: 'BUY' | 'SELL' = pos.quantity < 0 ? 'BUY' : 'SELL'
            const acct = accounts.find((a) => a.accountId === pos.account)
            rows.push({
                accountId: pos.account,
                alias: acct?.alias || pos.account,
                type: 'OPT',
                optKey: key,
                label: c.label,
                symbol: c.symbol,
                expiry: c.expiry,
                strike: c.strike,
                right: (c.right === 'C' || c.right === 'CALL' ? 'C' : 'P') as 'C' | 'P',
                action,
                qty,
                price
            })
        }

        // Sort by account alias, then type (STK first), then symbol
        rows.sort((a, b) => {
            if (a.alias !== b.alias) return a.alias.localeCompare(b.alias)
            if (a.type !== b.type) return a.type === 'STK' ? -1 : 1
            return 0
        })

        return rows
    }, [stockPositions, optionPositions, accounts, stkPrices, stkQtyOverrides, optPrices, optQtyOverrides, quotes, optQuotes, uniqueContracts])

    // Group preview rows by account
    const groupedByAccount = useMemo(() => {
        const map = new Map<string, { alias: string; rows: PreviewRow[] }>()
        for (const row of (step === 'preview' ? previewRows : confirmedRows)) {
            if (!map.has(row.accountId)) map.set(row.accountId, { alias: row.alias, rows: [] })
            map.get(row.accountId)!.rows.push(row)
        }
        // Sort by net liquidation descending
        return Array.from(map.entries()).sort((a, b) => {
            const acctA = accounts.find((x) => x.accountId === a[0])
            const acctB = accounts.find((x) => x.accountId === b[0])
            return (acctB?.netLiquidation || 0) - (acctA?.netLiquidation || 0)
        })
    }, [previewRows, confirmedRows, step, accounts])

    const totalQty = (step === 'preview' ? previewRows : confirmedRows).reduce((s, r) => s + r.qty, 0)

    const handleSubmit = useCallback(async () => {
        if (previewRows.length === 0) return
        setSubmitting(true)
        try {
            const allResults: OrderResult[] = []

            // 1) Place stock sell orders
            for (const sym of stkSymbols) {
                const allocations: Record<string, number> = {}
                let total = 0
                for (const row of confirmedRows) {
                    if (row.type === 'STK' && row.symbol === sym && row.qty > 0) {
                        allocations[row.accountId] = (allocations[row.accountId] || 0) + row.qty
                        total += row.qty
                    }
                }
                if (Object.keys(allocations).length > 0) {
                    const request = {
                        symbol: sym.toUpperCase(),
                        action: 'SELL' as const,
                        orderType: 'LMT' as const,
                        limitPrice: parseFloat(stkPrices[sym] || '0'),
                        totalQuantity: total,
                        outsideRth: stkOutsideRths[sym] || false,
                        tif: stkTifs[sym] || 'DAY'
                    }
                    const results = await window.ibApi.placeBatchOrders(request, allocations)
                    allResults.push(...results.map((r: OrderResult) => ({ ...r, symbol: sym })))
                }
            }

            // 2) Place option orders
            for (const [key, c] of uniqueContracts) {
                const allocations: Record<string, number> = {}
                let total = 0
                let action: 'BUY' | 'SELL' = 'SELL'
                for (const row of confirmedRows) {
                    if (row.type === 'OPT' && (row as OptPreviewRow).optKey === key && row.qty > 0) {
                        allocations[row.accountId] = (allocations[row.accountId] || 0) + row.qty
                        total += row.qty
                        action = row.action as 'BUY' | 'SELL'
                    }
                }
                if (Object.keys(allocations).length > 0) {
                    const request = {
                        symbol: c.symbol.toUpperCase(),
                        action,
                        orderType: 'LMT' as const,
                        limitPrice: parseFloat(optPrices[key] || '0'),
                        totalQuantity: total,
                        expiry: c.expiry,
                        strike: c.strike,
                        right: (c.right === 'C' || c.right === 'CALL' ? 'C' : 'P') as 'C' | 'P',
                        outsideRth: optOutsideRths[key] || false
                    }
                    const results = await window.ibApi.placeOptionBatchOrders(request, allocations)
                    allResults.push(...results.map((r: OrderResult) => ({ ...r, symbol: c.label })))
                }
            }

            setOrderResults(allResults)
            setStep('done')
        } catch (err) {
            console.error('Group close order failed:', err)
            alert('群組平倉下單失敗: ' + String(err))
        } finally {
            setSubmitting(false)
        }
    }, [confirmedRows, stkSymbols, stkPrices, stkTifs, stkOutsideRths, uniqueContracts, optPrices, optOutsideRths, previewRows])

    const handleClose = useCallback(() => {
        setStkPrices({})
        setStkTifs({})
        setStkOutsideRths({})
        setStkQuotes({})
        setStkQtyOverrides({})
        setOptPrices({})
        setOptTifs({})
        setOptOutsideRths({})
        setOptQuotes({})
        setOptQtyOverrides({})
        setOrderResults([])
        setStep('preview')
        setConfirmedRows([])
        setSubmitting(false)
        setTifOpen(null)
        onClose()
    }, [onClose])

    const renderTifDropdown = (
        id: string,
        tif: 'DAY' | 'GTC',
        outsideRth: boolean,
        isOpen: boolean,
        setTif: (v: 'DAY' | 'GTC') => void,
        setOutsideRth: (v: boolean) => void,
        setOpen: (v: boolean) => void
    ): React.JSX.Element => (
        <div className="tif-dropdown" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <button
                type="button"
                className={`tif-dropdown-trigger${outsideRth ? ' has-extras' : ''}`}
                onClick={() => setOpen(!isOpen)}
                disabled={step !== 'preview'}
            >
                {outsideRth ? <span className="tif-indicator" /> : null}
                {tif}
                <span className="tif-dropdown-arrow">▾</span>
            </button>
            {isOpen && (
                <div className="tif-dropdown-menu">
                    <div className={`tif-dropdown-item${tif === 'DAY' ? ' active' : ''}`} onClick={() => setTif('DAY')}>DAY</div>
                    <div className={`tif-dropdown-item${tif === 'GTC' ? ' active' : ''}`} onClick={() => setTif('GTC')}>GTC</div>
                    <div className="tif-dropdown-separator" />
                    <div className="tif-dropdown-checkbox" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOutsideRth(!outsideRth) }}>
                        <input type="checkbox" checked={outsideRth} readOnly />
                        非常規時間
                    </div>
                </div>
            )}
        </div>
    )

    if (!open) return null

    return (
        <div className="stock-order-dialog-overlay" onClick={handleClose}>
            <div className="stock-order-dialog" style={{ maxWidth: '950px' }} onClick={(e) => e.stopPropagation()}>
                <div className="stock-order-dialog-header">
                    <h2>群組平倉</h2>
                    <button className="settings-close-btn" onClick={handleClose}>✕</button>
                </div>
                <div className="stock-order-dialog-body">
                    {/* Stock price rows */}
                    {stkSymbols.length > 0 && (
                        <>
                            {stkSymbols.map((sym) => {
                                const q = stkQuotes[sym]
                                return (
                                    <div className="order-form" key={`stk-${sym}`} style={{ marginBottom: '20px' }}>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', width: '220px' }}>
                                                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#8b1a1a' }}>賣出</span>
                                                    <span style={{ fontWeight: 600, fontSize: '13px', textTransform: 'uppercase' }}>{sym}</span>
                                                </span>
                                                <span className="roll-order-label">限價</span>
                                                <input
                                                    type="number"
                                                    value={stkPrices[sym] || ''}
                                                    onChange={(e) => setStkPrices((prev) => ({ ...prev, [sym]: e.target.value }))}
                                                    placeholder="0.00"
                                                    step="0.01"
                                                    className="input-field"
                                                    style={{ width: '90px' }}
                                                    disabled={step !== 'preview'}
                                                />
                                                {renderTifDropdown(
                                                    `stk-${sym}`,
                                                    stkTifs[sym] || 'DAY',
                                                    stkOutsideRths[sym] || false,
                                                    tifOpen === `stk-${sym}`,
                                                    (v) => setStkTifs((prev) => ({ ...prev, [sym]: v })),
                                                    (v) => setStkOutsideRths((prev) => ({ ...prev, [sym]: v })),
                                                    (v) => setTifOpen(v ? `stk-${sym}` : null)
                                                )}
                                            </div>
                                            {q && (
                                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 13, flex: '0 0 auto' }}>
                                                    <span className="quote-bid">{q.bid.toFixed(2)}</span>
                                                    <span className="quote-separator">|</span>
                                                    <span className="quote-ask">{q.ask.toFixed(2)}</span>
                                                    <span className="quote-separator">|</span>
                                                    <span className="quote-label" style={{ fontWeight: 400 }}>最後價</span>
                                                    <span className="quote-last" style={{ color: '#1d4ed8' }}>{q.last.toFixed(2)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </>
                    )}

                    {/* Option price rows */}
                    {uniqueContracts.length > 0 && (
                        <>
                            {uniqueContracts.map(([key, c]) => {
                                const q = optQuotes[key]
                                const firstPos = optionPositions.find((p) => optionKey(p) === key)
                                const action = firstPos && firstPos.quantity < 0 ? '買入' : '賣出'
                                const actionColor = firstPos && firstPos.quantity < 0 ? '#1a6b3a' : '#8b1a1a'
                                return (
                                    <div key={key} className="order-form" style={{ marginBottom: '20px' }}>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', width: '220px' }}>
                                                    <span style={{ fontWeight: 600, fontSize: '13px', color: actionColor }}>{action}</span>
                                                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.label}</span>
                                                </span>
                                                <span className="roll-order-label">限價</span>
                                                <input
                                                    type="number"
                                                    value={optPrices[key] || ''}
                                                    onChange={(e) => setOptPrices((prev) => ({ ...prev, [key]: e.target.value }))}
                                                    className="input-field"
                                                    style={{ width: '90px' }}
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    disabled={step !== 'preview'}
                                                />
                                                {renderTifDropdown(
                                                    `opt-${key}`,
                                                    optTifs[key] || 'DAY',
                                                    optOutsideRths[key] || false,
                                                    tifOpen === `opt-${key}`,
                                                    (v) => setOptTifs((prev) => ({ ...prev, [key]: v })),
                                                    (v) => setOptOutsideRths((prev) => ({ ...prev, [key]: v })),
                                                    (v) => setTifOpen(v ? `opt-${key}` : null)
                                                )}
                                            </div>
                                            {q && (
                                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 13, flex: '0 0 auto' }}>
                                                    <span className="roll-order-value roll-order-bid">{q.bid.toFixed(2)}</span>
                                                    <span className="quote-separator">|</span>
                                                    <span className="roll-order-value roll-order-ask">{q.ask.toFixed(2)}</span>
                                                    <span className="quote-separator">|</span>
                                                    <span className="roll-order-label">中間價</span>
                                                    <span className="roll-order-value roll-order-mid">
                                                        {q.bid > 0 && q.ask > 0 ? ((q.bid + q.ask) / 2).toFixed(2) : q.last.toFixed(2)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </>
                    )}

                    {/* Preview table */}
                    {groupedByAccount.length > 0 && (
                        <div className="allocation-section">
                            <table className="allocation-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '20%', textAlign: 'left' }}>帳號</th>
                                        <th style={{ width: '10%' }}>淨值</th>
                                        <th style={{ width: '10%' }}>現金</th>
                                        <th style={{ width: '8%' }}>方向</th>
                                        <th style={{ width: '20%' }}>標的/期權</th>
                                        <th style={{ width: '10%' }}>價格</th>
                                        <th style={{ width: '10%' }}>數量</th>
                                        {step === 'done' && <th style={{ width: '10%' }}>狀態</th>}
                                    </tr>
                                </thead>
                                <>
                                    {groupedByAccount.map(([accountId, { alias, rows }], groupIdx) => {
                                        const acct = accounts.find((a) => a.accountId === accountId)
                                        if (!acct) return null
                                        const isLast = groupIdx === groupedByAccount.length - 1
                                        return (
                                            <tbody key={accountId} style={isLast ? undefined : { borderBottom: '2px solid #e5e7eb' }}>
                                                {rows.map((row, idx) => {
                                                    const isStk = row.type === 'STK'
                                                    const displayLabel = isStk ? row.symbol : (row as OptPreviewRow).label
                                                    const overrideKey = isStk
                                                        ? `${row.symbol}:${row.accountId}`
                                                        : `${(row as OptPreviewRow).optKey}:${row.accountId}`
                                                    const orderResult = orderResults.find(
                                                        (r) => r.account === row.accountId && r.symbol === displayLabel
                                                    )
                                                    return (
                                                        <tr key={`${accountId}-${idx}`} style={{ height: '44px' }}>
                                                            {idx === 0 && (
                                                                <>
                                                                    <td
                                                                        rowSpan={rows.length}
                                                                        style={{ fontWeight: 'bold', textAlign: 'left', borderBottom: '1px solid #b0b0b0' }}
                                                                    >
                                                                        {alias}
                                                                    </td>
                                                                    <td rowSpan={rows.length} style={{ borderBottom: '1px solid #b0b0b0' }}>
                                                                        {acct.netLiquidation.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                                    </td>
                                                                    <td
                                                                        rowSpan={rows.length}
                                                                        style={{
                                                                            borderBottom: '1px solid #b0b0b0',
                                                                            ...(acct.totalCashValue < 0 ? { color: '#8b1a1a' } : {})
                                                                        }}
                                                                    >
                                                                        {acct.totalCashValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                                    </td>
                                                                </>
                                                            )}
                                                            <td style={{ color: row.action === 'BUY' ? '#1a6b3a' : '#8b1a1a', fontWeight: 'bold' }}>
                                                                {row.action === 'BUY' ? '買入' : '賣出'}
                                                            </td>
                                                            <td style={{ fontSize: '0.93em' }}>{displayLabel}</td>
                                                            <td>
                                                                {isStk
                                                                    ? stkPrices[row.symbol] || '-'
                                                                    : optPrices[(row as OptPreviewRow).optKey] || '-'}
                                                            </td>
                                                            <td>
                                                                {step === 'preview' ? (
                                                                    <input
                                                                        type="number"
                                                                        value={row.qty}
                                                                        onChange={(e) => {
                                                                            const val = parseInt(e.target.value) || 0
                                                                            if (isStk) {
                                                                                setStkQtyOverrides((prev) => ({ ...prev, [overrideKey]: val }))
                                                                            } else {
                                                                                setOptQtyOverrides((prev) => ({ ...prev, [overrideKey]: val }))
                                                                            }
                                                                        }}
                                                                        className="input-field"
                                                                        style={{ width: '70px', textAlign: 'center' }}
                                                                    />
                                                                ) : (
                                                                    row.qty.toLocaleString()
                                                                )}
                                                            </td>
                                                            {step === 'done' && (
                                                                <td style={{ fontSize: '11px' }}>
                                                                    {orderResult ? orderResult.status : '-'}
                                                                </td>
                                                            )}
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        )
                                    })}
                                </>
                            </table>
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="confirm-buttons" style={{ marginTop: '16px' }}>
                        {step === 'preview' && (
                            <button
                                className="btn btn-primary"
                                disabled={totalQty === 0}
                                onClick={() => {
                                    setConfirmedRows([...previewRows])
                                    setStep('confirm')
                                }}
                            >
                                預覽下單
                            </button>
                        )}
                        {step === 'confirm' && (
                            <>
                                <button className="btn btn-danger" disabled={submitting} onClick={handleSubmit}>
                                    {submitting ? '下單中...' : '確認平倉'}
                                </button>
                                <button className="btn btn-secondary" disabled={submitting} onClick={() => setStep('preview')}>
                                    返回修改
                                </button>
                            </>
                        )}
                        {step === 'done' && (
                            <button className="btn btn-secondary" onClick={handleClose}>
                                關閉
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
