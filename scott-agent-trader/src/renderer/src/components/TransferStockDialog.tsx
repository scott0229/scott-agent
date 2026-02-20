import { useState, useEffect, useMemo, useCallback } from 'react'
import CustomSelect from './CustomSelect'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

interface TransferStockDialogProps {
    open: boolean
    onClose: () => void
    selectedPositions: PositionData[]
    accounts: AccountData[]
    quotes: Record<string, number>
}

interface TransferPreview {
    accountId: string
    alias: string
    sellQty: number
    sellValue: number
    buyQty: number
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

export default function TransferStockDialog({
    open,
    onClose,
    selectedPositions,
    accounts,
    quotes
}: TransferStockDialogProps): JSX.Element | null {
    const [targetSymbol, setTargetSymbol] = useState('')
    const [sellTif, setSellTif] = useState<'DAY' | 'GTC'>('DAY')
    const [buyTif, setBuyTif] = useState<'DAY' | 'GTC'>('DAY')
    const [sellPrice, setSellPrice] = useState('')
    const [buyPrice, setBuyPrice] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [orderResults, setOrderResults] = useState<OrderResult[]>([])
    const [step, setStep] = useState<'preview' | 'confirm' | 'done'>('preview')
    const [confirmedPreviews, setConfirmedPreviews] = useState<TransferPreview[]>([])
    const [confirmedSourceSymbol, setConfirmedSourceSymbol] = useState('')
    const [confirmedTargetSymbol, setConfirmedTargetSymbol] = useState('')
    const [sellQuote, setSellQuote] = useState<{ bid: number; ask: number; last: number } | null>(null)
    const [buyQuote, setBuyQuote] = useState<{ bid: number; ask: number; last: number } | null>(null)

    const sourceSymbol = selectedPositions.length > 0 ? selectedPositions[0].symbol : ''
    const sourceLastPrice = quotes[sourceSymbol] || 0

    // Group selected positions by account
    const accountPositions = useMemo(() => {
        const map = new Map<string, { qty: number; avgCost: number }>()
        for (const pos of selectedPositions) {
            const existing = map.get(pos.account)
            if (existing) {
                const totalQty = existing.qty + pos.quantity
                existing.avgCost = totalQty > 0
                    ? (existing.avgCost * existing.qty + pos.avgCost * pos.quantity) / totalQty
                    : 0
                existing.qty = totalQty
            } else {
                map.set(pos.account, { qty: pos.quantity, avgCost: pos.avgCost })
            }
        }
        return map
    }, [selectedPositions])

    // Fetch source quote on mount + auto-refresh every 5s
    useEffect(() => {
        if (!sourceSymbol) return
        const fetchQuote = async (): Promise<void> => {
            try {
                const quote = await window.ibApi.getStockQuote(sourceSymbol)
                setSellQuote(quote)
            } catch {
                // ignore
            }
        }
        const timer = setTimeout(fetchQuote, 300)
        const interval = setInterval(fetchQuote, 5000)
        return () => { clearTimeout(timer); clearInterval(interval) }
    }, [sourceSymbol])

    // Fetch target quote on symbol change + auto-refresh every 5s
    useEffect(() => {
        const trimmed = targetSymbol.trim().toUpperCase()
        if (!trimmed) {
            setBuyQuote(null)
            return
        }
        let isFirst = true
        const fetchQuote = async (): Promise<void> => {
            try {
                const quote = await window.ibApi.getStockQuote(trimmed)
                setBuyQuote(quote)
                if (isFirst && quote.last > 0) {
                    setBuyPrice(quote.last.toFixed(2))
                    isFirst = false
                }
            } catch {
                setBuyQuote(null)
            }
        }
        const timer = setTimeout(fetchQuote, 500)
        const interval = setInterval(fetchQuote, 5000)
        return () => { clearTimeout(timer); clearInterval(interval) }
    }, [targetSymbol])

    // Auto-fill sell price from source quote
    useEffect(() => {
        if (sourceLastPrice > 0) {
            setSellPrice(sourceLastPrice.toFixed(2))
        }
    }, [sourceLastPrice])

    // Listen for order status updates
    useEffect(() => {
        const unsubscribe = window.ibApi.onOrderStatus((update: OrderResult) => {
            setOrderResults((prev) =>
                prev.map((r) =>
                    r.orderId === update.orderId
                        ? { ...r, ...update, account: r.account, symbol: r.symbol }
                        : r
                )
            )
        })
        return () => { unsubscribe() }
    }, [])

    // Calculate preview for each account
    const previews = useMemo((): TransferPreview[] => {
        const buyPriceNum = parseFloat(buyPrice) || 0
        const result: TransferPreview[] = []

        for (const [accountId, posInfo] of accountPositions) {
            const acct = accounts.find((a) => a.accountId === accountId)
            const sellQty = posInfo.qty
            const sellValue = sellQty * (parseFloat(sellPrice) || sourceLastPrice || posInfo.avgCost)
            const buyQty = buyPriceNum > 0 ? Math.floor(sellValue / buyPriceNum) : 0

            result.push({
                accountId,
                alias: acct?.alias || accountId,
                sellQty,
                sellValue,
                buyQty
            })
        }
        return result.sort((a, b) => {
            const acctA = accounts.find((x) => x.accountId === a.accountId)
            const acctB = accounts.find((x) => x.accountId === b.accountId)
            return (acctB?.netLiquidation || 0) - (acctA?.netLiquidation || 0)
        })
    }, [accountPositions, accounts, sellPrice, buyPrice, sourceLastPrice])

    const totalSellQty = previews.reduce((s, p) => s + p.sellQty, 0)
    const totalBuyQty = previews.reduce((s, p) => s + p.buyQty, 0)

    const handleSubmit = useCallback(async () => {
        if (!targetSymbol.trim() || previews.length === 0) return
        setSubmitting(true)

        try {
            // Build sell allocations
            const sellAllocations: Record<string, number> = {}
            const buyAllocations: Record<string, number> = {}

            for (const p of previews) {
                if (p.sellQty > 0) sellAllocations[p.accountId] = p.sellQty
                if (p.buyQty > 0) buyAllocations[p.accountId] = p.buyQty
            }

            const allResults: OrderResult[] = []

            // Place sell orders
            if (Object.keys(sellAllocations).length > 0) {
                const sellRequest = {
                    symbol: sourceSymbol.toUpperCase(),
                    action: 'SELL' as const,
                    orderType: 'LMT' as const,
                    limitPrice: parseFloat(sellPrice),
                    totalQuantity: totalSellQty,
                    outsideRth: false,
                    tif: sellTif
                }
                const sellResults = await window.ibApi.placeBatchOrders(sellRequest, sellAllocations)
                allResults.push(...sellResults.map((r: OrderResult) => ({ ...r, symbol: sourceSymbol })))
            }

            // Place buy orders
            if (Object.keys(buyAllocations).length > 0) {
                const buyRequest = {
                    symbol: targetSymbol.trim().toUpperCase(),
                    action: 'BUY' as const,
                    orderType: 'LMT' as const,
                    limitPrice: parseFloat(buyPrice),
                    totalQuantity: totalBuyQty,
                    outsideRth: false,
                    tif: buyTif
                }
                const buyResults = await window.ibApi.placeBatchOrders(buyRequest, buyAllocations)
                allResults.push(...buyResults.map((r: OrderResult) => ({ ...r, symbol: targetSymbol.trim().toUpperCase() })))
            }

            setOrderResults(allResults)
            setStep('done')
        } catch (err) {
            console.error('Transfer order failed:', err)
            alert('轉倉下單失敗: ' + String(err))
        } finally {
            setSubmitting(false)
        }
    }, [targetSymbol, previews, sourceSymbol, sellPrice, buyPrice, totalSellQty, totalBuyQty, sellTif, buyTif])

    const handleClose = useCallback(() => {
        setTargetSymbol('')
        setSellPrice('')
        setBuyPrice('')
        setSellTif('DAY')
        setBuyTif('DAY')
        setOrderResults([])
        setStep('preview')
        setConfirmedPreviews([])
        setConfirmedSourceSymbol('')
        setConfirmedTargetSymbol('')
        setSubmitting(false)
        onClose()
    }, [onClose])

    if (!open) return null

    return (
        <div className="stock-order-dialog-overlay" onClick={handleClose}>
            <div className="stock-order-dialog transfer-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="stock-order-dialog-header">
                    <h2>股票轉倉</h2>
                    <button className="settings-close-btn" onClick={handleClose}>✕</button>
                </div>
                <div className="stock-order-dialog-body">
                    {/* Sell row: source symbol */}
                    <div className="order-form">
                        <div className="form-row">
                            <div className="form-group" style={{ flex: '0 0 auto' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px', color: '#8b1a1a', padding: '6px 0' }}>賣出</span>
                            </div>
                            <div className="form-group" style={{ flex: '0 0 80px' }}>
                                <input
                                    type="text"
                                    value={sourceSymbol}
                                    className="input-field"
                                    disabled
                                    style={{ textTransform: 'uppercase' }}
                                />
                            </div>
                            <div className="form-group">
                                <input
                                    type="number"
                                    value={sellPrice}
                                    onChange={(e) => setSellPrice(e.target.value)}
                                    placeholder="限價"
                                    step="0.01"
                                    className="input-field"
                                    disabled={step !== 'preview'}
                                />
                            </div>
                            <div className="form-group" style={{ flex: '0 0 auto' }}>
                                <CustomSelect
                                    value={sellTif}
                                    onChange={(v) => setSellTif(v as 'DAY' | 'GTC')}
                                    options={[
                                        { value: 'DAY', label: 'DAY' },
                                        { value: 'GTC', label: 'GTC' }
                                    ]}
                                />
                            </div>
                            {sellQuote && (
                                <div className="quote-display" style={{ flex: '0 0 auto' }}>
                                    <span className="quote-bid">{sellQuote.bid.toFixed(2)}</span>
                                    <span className="quote-separator">|</span>
                                    <span className="quote-ask">{sellQuote.ask.toFixed(2)}</span>
                                    <span className="quote-separator">|</span>
                                    <span className="quote-label">Last</span>
                                    <span className="quote-last" style={{ color: '#1a3a6b' }}>{sellQuote.last.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Buy row: target symbol */}
                    <div className="order-form" style={{ marginTop: '8px' }}>
                        <div className="form-row">
                            <div className="form-group" style={{ flex: '0 0 auto' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px', color: '#1a6b3a', padding: '6px 0' }}>買入</span>
                            </div>
                            <div className="form-group">
                                <input
                                    type="text"
                                    value={targetSymbol}
                                    onChange={(e) => setTargetSymbol(e.target.value)}
                                    placeholder="股票代碼"
                                    style={{ textTransform: 'uppercase' }}
                                    className="input-field"
                                    disabled={step !== 'preview'}
                                />
                            </div>
                            <div className="form-group">
                                <input
                                    type="number"
                                    value={buyPrice}
                                    onChange={(e) => setBuyPrice(e.target.value)}
                                    placeholder="限價"
                                    step="0.01"
                                    className="input-field"
                                    disabled={step !== 'preview'}
                                />
                            </div>
                            <div className="form-group" style={{ flex: '0 0 auto' }}>
                                <CustomSelect
                                    value={buyTif}
                                    onChange={(v) => setBuyTif(v as 'DAY' | 'GTC')}
                                    options={[
                                        { value: 'DAY', label: 'DAY' },
                                        { value: 'GTC', label: 'GTC' }
                                    ]}
                                />
                            </div>
                            {targetSymbol.trim() && buyQuote && (
                                <div className="quote-display" style={{ flex: '0 0 auto' }}>
                                    <span className="quote-bid">{buyQuote.bid.toFixed(2)}</span>
                                    <span className="quote-separator">|</span>
                                    <span className="quote-ask">{buyQuote.ask.toFixed(2)}</span>
                                    <span className="quote-separator">|</span>
                                    <span className="quote-label">Last</span>
                                    <span className="quote-last" style={{ color: '#1a3a6b' }}>{buyQuote.last.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Preview table */}
                    {(step === 'preview' ? previews : confirmedPreviews).length > 0 && (
                        <div className="allocation-section">
                            <table className="allocation-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '18%', textAlign: 'left' }}>帳號</th>
                                        <th style={{ width: '12%' }}>淨值</th>
                                        <th style={{ width: '12%' }}>現金</th>
                                        <th style={{ width: '10%' }}>方向</th>
                                        <th style={{ width: '10%' }}>標的</th>
                                        <th style={{ width: '10%' }}>價格</th>
                                        <th style={{ width: '12%' }}>數量</th>
                                        {step === 'done' && <th style={{ width: '12%' }}>狀態</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(step === 'preview' ? previews : confirmedPreviews).map((p) => {
                                        const acct = accounts.find((a) => a.accountId === p.accountId)
                                        if (!acct) return null
                                        const displaySourceSymbol = step === 'preview' ? sourceSymbol : confirmedSourceSymbol
                                        const displayTargetSymbol = step === 'preview' ? targetSymbol.toUpperCase() : confirmedTargetSymbol
                                        const sellResult = orderResults.find((r) => r.account === p.accountId && r.symbol === displaySourceSymbol)
                                        const buyResult = orderResults.find((r) => r.account === p.accountId && r.symbol === displayTargetSymbol)
                                        return (
                                            <>
                                                <tr key={`${p.accountId}-sell`}>
                                                    <td rowSpan={2} style={{ fontWeight: 'bold', textAlign: 'left' }}>{p.alias}</td>
                                                    <td rowSpan={2}>{acct.netLiquidation.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                                                    <td rowSpan={2} style={acct.totalCashValue < 0 ? { color: '#8b1a1a' } : undefined}>{acct.totalCashValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                                                    <td style={{ color: '#8b1a1a', fontWeight: 'bold' }}>賣出</td>
                                                    <td>{displaySourceSymbol}</td>
                                                    <td>{sellPrice || '-'}</td>
                                                    <td>{p.sellQty.toLocaleString()}</td>
                                                    {step === 'done' && (
                                                        <td style={{ fontSize: '11px' }}>{sellResult ? sellResult.status : '-'}</td>
                                                    )}
                                                </tr>
                                                <tr key={`${p.accountId}-buy`}>
                                                    <td style={{ color: '#1a6b3a', fontWeight: 'bold' }}>買入</td>
                                                    <td>{displayTargetSymbol || '-'}</td>
                                                    <td>{buyPrice || '-'}</td>
                                                    <td>{p.buyQty.toLocaleString()}</td>
                                                    {step === 'done' && (
                                                        <td style={{ fontSize: '11px' }}>{buyResult ? buyResult.status : '-'}</td>
                                                    )}
                                                </tr>
                                            </>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="confirm-buttons" style={{ marginTop: '16px' }}>
                        {step === 'preview' && (
                            <button
                                className="btn btn-primary"
                                disabled={!targetSymbol.trim() || totalBuyQty === 0 || !sellPrice || !buyPrice}
                                onClick={() => { setConfirmedPreviews(previews); setConfirmedSourceSymbol(sourceSymbol); setConfirmedTargetSymbol(targetSymbol.trim().toUpperCase()); setStep('confirm') }}
                            >
                                預覽下單
                            </button>
                        )}
                        {step === 'confirm' && (
                            <>
                                <button
                                    className="btn btn-danger"
                                    disabled={submitting}
                                    onClick={handleSubmit}
                                >
                                    {submitting ? '下單中...' : `確認轉倉 (賣${sourceSymbol} → 買${targetSymbol.trim().toUpperCase()})`}
                                </button>
                                <button className="btn btn-secondary" onClick={() => setStep('preview')}>
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
