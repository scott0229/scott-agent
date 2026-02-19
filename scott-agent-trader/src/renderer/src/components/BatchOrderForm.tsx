import { useState, useEffect, useCallback, useRef } from 'react'
import CustomSelect from './CustomSelect'
import type { AccountData, PositionData } from '../hooks/useAccountStore'



interface OrderResult {
    orderId: number
    account: string
    status: string
    filled: number
    remaining: number
    avgFillPrice: number
    symbol: string
}

interface BatchOrderFormProps {
    connected: boolean
    accounts: AccountData[]
    positions: PositionData[]
}

export default function BatchOrderForm({ connected, accounts, positions }: BatchOrderFormProps): JSX.Element {
    const [symbol, setSymbol] = useState('')
    const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
    const [limitPrice, setLimitPrice] = useState('')
    const [quantities, setQuantities] = useState<Record<string, string>>({})
    const [selectedUser, setSelectedUser] = useState('ALL')
    const [stockQuote, setStockQuote] = useState<{ bid: number; ask: number; last: number } | null>(
        null
    )
    const [loadingQuote, setLoadingQuote] = useState(false)

    const [orderResults, setOrderResults] = useState<OrderResult[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [checkedAccounts, setCheckedAccounts] = useState<Set<string>>(new Set())
    const [tif, setTif] = useState<'DAY' | 'GTC'>('DAY')
    const [outsideRth, setOutsideRth] = useState(false)
    const [tifDropdownOpen, setTifDropdownOpen] = useState(false)
    const tifDropdownRef = useRef<HTMLDivElement>(null)

    // Close TIF dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent): void => {
            if (tifDropdownRef.current && !tifDropdownRef.current.contains(e.target as Node)) {
                setTifDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Fetch stock quote when symbol changes (debounced)
    useEffect(() => {
        const trimmed = symbol.trim().toUpperCase()
        if (!trimmed || !connected) {
            setStockQuote(null)
            return
        }
        const timer = setTimeout(async () => {
            setLoadingQuote(true)
            try {
                const quote = await window.ibApi.getStockQuote(trimmed)
                setStockQuote(quote)
            } catch {
                setStockQuote(null)
            } finally {
                setLoadingQuote(false)
            }
        }, 500)
        return () => clearTimeout(timer)
    }, [symbol, connected])

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

        return () => {
            unsubscribe()
        }
    }, [])

    // Build allocations based on selected user
    const sortedAccounts = [...accounts].sort((a, b) => b.netLiquidation - a.netLiquidation)
    const targetAccounts =
        selectedUser === 'ALL' ? sortedAccounts : sortedAccounts.filter((a) => a.accountId === selectedUser)
    const allocations: Record<string, number> = {}
    for (const acct of targetAccounts) {
        if (!checkedAccounts.has(acct.accountId)) continue
        const q = parseInt(quantities[acct.accountId] || '0', 10) || 0
        if (q > 0) allocations[acct.accountId] = q
    }
    const totalAllocated = Object.values(allocations).reduce((sum, q) => sum + q, 0)

    const handleQuantityChange = (accountId: string, value: string) => {
        if (action === 'SELL' && symbol.trim()) {
            const holding = positions
                .filter(p => p.account === accountId && p.symbol.toUpperCase() === symbol.trim().toUpperCase() && p.secType === 'STK' && p.quantity > 0)
                .reduce((sum, p) => sum + p.quantity, 0)
            const num = parseInt(value, 10)
            if (!isNaN(num) && num > holding) {
                value = holding.toString()
            }
        }
        setQuantities((prev) => ({ ...prev, [accountId]: value }))
    }

    const handleSubmit = useCallback(async () => {
        if (!symbol.trim() || Object.keys(allocations).length === 0) return

        setSubmitting(true)
        setShowConfirm(false)
        try {
            const request = {
                symbol: symbol.toUpperCase(),
                action,
                orderType: 'LMT' as const,
                limitPrice: parseFloat(limitPrice),
                totalQuantity: totalAllocated,
                outsideRth,
                tif
            }

            const results = await window.ibApi.placeBatchOrders(request, allocations)
            setOrderResults(results)
        } catch (err: unknown) {
            console.error('Batch order failed:', err)
        } finally {
            setSubmitting(false)
        }
    }, [symbol, action, limitPrice, allocations, totalAllocated, outsideRth, tif])

    if (!connected) {
        return (
            <div className="panel">
                <div className="empty-state">請先連線到 TWS / IB Gateway</div>
            </div>
        )
    }

    return (
        <div>
            {/* Order Form */}
            <div className="order-form" style={showConfirm ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                <div className="form-row">
                    <div className="form-group">
                        <CustomSelect
                            value={selectedUser}
                            onChange={setSelectedUser}
                            options={[
                                { value: 'ALL', label: '全部帳戶' },
                                ...sortedAccounts.map((acct) => ({
                                    value: acct.accountId,
                                    label: acct.alias || acct.accountId
                                }))
                            ]}
                        />
                    </div>
                    <div className="form-group">
                        <CustomSelect
                            value={action}
                            onChange={(v) => setAction(v as 'BUY' | 'SELL')}
                            options={[
                                { value: 'BUY', label: '買入' },
                                { value: 'SELL', label: '賣出' }
                            ]}
                        />
                    </div>
                    <div className="form-group">
                        <input
                            type="text"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            placeholder="股票代碼"
                            style={{ textTransform: 'uppercase' }}
                            className="input-field"
                        />
                    </div>

                    <div className="form-group">
                        <input
                            type="number"
                            value={limitPrice}
                            onChange={(e) => setLimitPrice(e.target.value)}
                            placeholder="限價"
                            step="0.01"
                            className="input-field"
                        />
                    </div>
                    <div className="tif-dropdown" ref={tifDropdownRef}>
                        <button
                            type="button"
                            className={`tif-dropdown-trigger${outsideRth ? ' has-extras' : ''}`}
                            onClick={() => setTifDropdownOpen(!tifDropdownOpen)}
                        >
                            {outsideRth ? <span className="tif-indicator" /> : null}
                            {tif}
                            <span className="tif-dropdown-arrow">▾</span>
                        </button>
                        {tifDropdownOpen && (
                            <div className="tif-dropdown-menu">
                                <div
                                    className={`tif-dropdown-item${tif === 'DAY' ? ' active' : ''}`}
                                    onClick={() => { setTif('DAY'); }}
                                >
                                    DAY
                                </div>
                                <div
                                    className={`tif-dropdown-item${tif === 'GTC' ? ' active' : ''}`}
                                    onClick={() => { setTif('GTC'); }}
                                >
                                    GTC
                                </div>
                                <div className="tif-dropdown-separator" />
                                <label className="tif-dropdown-checkbox">
                                    <input type="checkbox" checked={outsideRth} onChange={(e) => setOutsideRth(e.target.checked)} />
                                    非常規時間
                                </label>
                            </div>
                        )}
                    </div>
                    {/* Bid / Ask display */}
                    {loadingQuote ? (
                        <div className="quote-display">
                            <span className="quote-loading">載入報價中...</span>
                        </div>
                    ) : stockQuote ? (
                        <div className="quote-display">
                            <span className="quote-bid">{stockQuote.bid.toFixed(2)}</span>
                            <span className="quote-separator">|</span>
                            <span className="quote-ask">{stockQuote.ask.toFixed(2)}</span>
                            <span className="quote-separator">|</span>
                            <span className="quote-label">Last</span>
                            <span className="quote-last" style={{ color: '#1a3a6b' }}>{stockQuote.last.toFixed(2)}</span>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Account Allocation Table */}
            {targetAccounts.length > 0 && (
                <div className="allocation-section" style={showConfirm ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                    <table className="allocation-table">
                        <thead>
                            <tr>
                                <th style={{ width: '4%' }}>
                                    <input
                                        type="checkbox"
                                        checked={targetAccounts.length > 0 && checkedAccounts.size === targetAccounts.length}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setCheckedAccounts(new Set(targetAccounts.map(a => a.accountId)))
                                            } else {
                                                setCheckedAccounts(new Set())
                                            }
                                        }}
                                    />
                                </th>
                                <th style={{ width: '15%' }}>帳號</th>
                                <th style={{ width: '9%' }}>淨值</th>
                                <th style={{ width: '9%' }}>現金</th>

                                <th style={{ width: '7%' }}>潛在融資</th>
                                <th style={{ width: '7%' }}>新融資</th>
                                {action === 'SELL' && <th style={{ width: '8%' }}>庫存</th>}
                                {action === 'SELL' && <th style={{ width: '8%' }}>成本</th>}
                                <th style={{ width: '8%' }}>方向</th>
                                <th style={{ width: '8%' }}>標的</th>
                                <th style={{ width: '7%' }}>價格</th>
                                <th style={{ width: '10%' }}>數量</th>
                            </tr>
                        </thead>
                        <tbody>
                            {targetAccounts.map((acct) => {
                                const isChecked = checkedAccounts.has(acct.accountId)
                                const stkPositions = action === 'SELL' ? positions
                                    .filter(p => p.account === acct.accountId && p.symbol.toUpperCase() === symbol.trim().toUpperCase() && p.secType === 'STK' && p.quantity > 0) : []
                                const stockHolding = stkPositions.reduce((sum, p) => sum + p.quantity, 0)
                                const stockAvgCost = stockHolding > 0
                                    ? stkPositions.reduce((sum, p) => sum + p.avgCost * p.quantity, 0) / stockHolding
                                    : 0
                                return (
                                    <tr key={acct.accountId}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                    setCheckedAccounts((prev) => {
                                                        const next = new Set(prev)
                                                        if (e.target.checked) {
                                                            next.add(acct.accountId)
                                                        } else {
                                                            next.delete(acct.accountId)
                                                        }
                                                        return next
                                                    })
                                                }}
                                            />
                                        </td>
                                        <td style={{ fontWeight: 'bold' }}>{acct.alias || acct.accountId}</td>
                                        <td>{acct.netLiquidation.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                                        <td style={acct.totalCashValue < 0 ? { color: '#8b1a1a' } : undefined}>{acct.totalCashValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>

                                        <td>{(() => {
                                            if (acct.netLiquidation <= 0) return '無融資'
                                            const putCost = positions
                                                .filter(p => p.account === acct.accountId && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT') && p.quantity < 0)
                                                .reduce((sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity), 0)
                                            const potential = (acct.grossPositionValue + putCost) / acct.netLiquidation
                                            return potential > 0 ? potential.toFixed(2) : '無融資'
                                        })()}</td>
                                        <td>{(() => {
                                            if (acct.netLiquidation <= 0) return '無融資'
                                            const putCost2 = positions
                                                .filter(p => p.account === acct.accountId && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT') && p.quantity < 0)
                                                .reduce((sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity), 0)
                                            const qty = parseInt(quantities[acct.accountId] || '0', 10) || 0
                                            const price = parseFloat(limitPrice) || 0
                                            const orderVal = qty * price
                                            const newGPV = action === 'BUY' ? acct.grossPositionValue + orderVal : Math.max(0, acct.grossPositionValue - orderVal)
                                            const newPotential = (newGPV + putCost2) / acct.netLiquidation
                                            return newPotential > 0 ? newPotential.toFixed(2) : '無融資'
                                        })()}</td>
                                        {action === 'SELL' && <td>{stockHolding}</td>}
                                        {action === 'SELL' && <td>{stockAvgCost > 0 ? stockAvgCost.toFixed(2) : '-'}</td>}
                                        {isChecked ? (
                                            <>
                                                <td style={{ color: action === 'BUY' ? '#1a6b3a' : '#8b1a1a', fontWeight: 'bold' }}>{action === 'BUY' ? '買入' : '賣出'}</td>
                                                <td>{symbol.toUpperCase() || '-'}</td>
                                                <td>{limitPrice || '-'}</td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        value={quantities[acct.accountId] || ''}
                                                        onChange={(e) => handleQuantityChange(acct.accountId, e.target.value)}
                                                        min="0"
                                                        max={action === 'SELL' ? stockHolding.toString() : undefined}
                                                        className="input-field input-small"
                                                    />
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td></td>
                                                <td></td>
                                                <td></td>
                                                <td></td>
                                            </>
                                        )}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Submit */}
            <div className="order-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {!showConfirm ? (
                    <button
                        onClick={() => setShowConfirm(true)}
                        className="btn btn-primary"
                        disabled={!symbol.trim() || totalAllocated === 0 || submitting || checkedAccounts.size !== Object.keys(allocations).length}
                    >
                        預覽下單
                    </button>
                ) : (
                    <div className="confirm-section">
                        <div className="confirm-summary">
                            確定要下單？
                        </div>
                        <table className="allocation-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}></th>
                                    <th style={{ width: '20%' }}>帳號</th>
                                    <th style={{ width: '8%' }}>方向</th>
                                    <th style={{ width: '12%' }}>標的</th>
                                    <th style={{ width: '12%' }}>限價</th>
                                    <th style={{ width: '8%' }}>數量</th>
                                    <th style={{ width: '15%' }}>新潛在融資</th>

                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(allocations).map(([accountId, qty], index) => {
                                    const acct = targetAccounts.find((a) => a.accountId === accountId)
                                    const price = parseFloat(limitPrice) || 0
                                    const orderValue = qty * price
                                    const currentGPV = acct?.grossPositionValue ?? 0
                                    const netLiq = acct?.netLiquidation ?? 0
                                    const newGPV = action === 'BUY' ? currentGPV + orderValue : Math.max(0, currentGPV - orderValue)
                                    const postLeverage = netLiq > 0 && newGPV > 0 ? (newGPV / netLiq).toFixed(2) : '無融資'

                                    return (
                                        <tr key={accountId}>
                                            <td>{index + 1}.</td>
                                            <td style={{ fontWeight: 'bold' }}>{acct?.alias || accountId}</td>
                                            <td style={{ color: action === 'BUY' ? '#1a6b3a' : '#8b1a1a', fontWeight: 'bold' }}>{action === 'BUY' ? '買入' : '賣出'}</td>
                                            <td>{symbol.toUpperCase()}</td>
                                            <td>{limitPrice}</td>
                                            <td style={{ color: '#1a3a6b' }}>{qty.toLocaleString()}</td>
                                            <td>{postLeverage}</td>

                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                        <div className="confirm-buttons">
                            <button onClick={handleSubmit} className="btn btn-danger" disabled={submitting}>
                                {submitting ? '下單中...' : '確認下單'}
                            </button>
                            <button onClick={() => setShowConfirm(false)} className="btn btn-secondary">
                                取消
                            </button>
                        </div>
                    </div>
                )}

            </div>

            {/* Order Results */}
            {orderResults.length > 0 && (
                <div className="order-results">
                    <h3>下單結果</h3>
                    <table className="results-table">
                        <thead>
                            <tr>
                                <th>訂單 ID</th>
                                <th>帳戶</th>
                                <th>狀態</th>
                                <th>已成交</th>
                                <th>均價</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orderResults.map((result) => (
                                <tr key={result.orderId}>
                                    <td>{result.orderId}</td>
                                    <td>{result.account}</td>
                                    <td className={`status-${result.status.toLowerCase()}`}>{result.status}</td>
                                    <td>
                                        {result.filled} / {result.filled + result.remaining}
                                    </td>
                                    <td>{result.avgFillPrice > 0 ? `$${result.avgFillPrice.toFixed(2)}` : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
