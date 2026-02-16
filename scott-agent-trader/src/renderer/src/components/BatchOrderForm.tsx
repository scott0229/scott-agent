import { useState, useEffect, useCallback } from 'react'
import CustomSelect from './CustomSelect'

interface AccountData {
    accountId: string
    alias: string
    netLiquidation: number
    availableFunds: number
    grossPositionValue: number
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

interface BatchOrderFormProps {
    connected: boolean
}

export default function BatchOrderForm({ connected }: BatchOrderFormProps): JSX.Element {
    const [symbol, setSymbol] = useState('')
    const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
    const [limitPrice, setLimitPrice] = useState('')
    const [quantities, setQuantities] = useState<Record<string, string>>({})
    const [selectedUser, setSelectedUser] = useState('ALL')
    const [stockQuote, setStockQuote] = useState<{ bid: number; ask: number; last: number } | null>(
        null
    )
    const [loadingQuote, setLoadingQuote] = useState(false)

    const [accounts, setAccounts] = useState<AccountData[]>([])
    const [orderResults, setOrderResults] = useState<OrderResult[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [checkedAccounts, setCheckedAccounts] = useState<Set<string>>(new Set())

    // Fetch accounts when connected
    useEffect(() => {
        if (connected) {
            window.ibApi.getAccountSummary().then((data) => {
                setAccounts(data)
                // Fetch aliases in background
                const accountIds = data.map((a: AccountData) => a.accountId)
                if (accountIds.length > 0) {
                    window.ibApi.getAccountAliases(accountIds).then((aliasMap) => {
                        setAccounts((prev) =>
                            prev.map((a) => ({ ...a, alias: aliasMap[a.accountId] || a.alias }))
                        )
                    }).catch(() => { /* ignore */ })
                }
            })
        } else {
            setAccounts([])
        }
    }, [connected])

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
        window.ibApi.onOrderStatus((update: OrderResult) => {
            setOrderResults((prev) =>
                prev.map((r) =>
                    r.orderId === update.orderId
                        ? { ...r, ...update, account: r.account, symbol: r.symbol }
                        : r
                )
            )
        })

        return () => {
            window.ibApi.removeAllListeners()
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
                totalQuantity: totalAllocated
            }

            const results = await window.ibApi.placeBatchOrders(request, allocations)
            setOrderResults(results)
        } catch (err: unknown) {
            console.error('Batch order failed:', err)
        } finally {
            setSubmitting(false)
        }
    }, [symbol, action, limitPrice, allocations, totalAllocated])

    if (!connected) {
        return (
            <div className="panel">
                <div className="empty-state">請先連線到 TWS / IB Gateway</div>
            </div>
        )
    }

    return (
        <div className="panel">
            {/* Order Form */}
            <div className="order-form" style={showConfirm ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                <div className="form-row">
                    <div className="form-group">
                        <label>帳戶</label>
                        <CustomSelect
                            value={selectedUser}
                            onChange={setSelectedUser}
                            options={[
                                { value: 'ALL', label: '全部帳戶' },
                                ...sortedAccounts.map((acct) => ({
                                    value: acct.accountId,
                                    label: acct.accountId + (acct.alias ? ` - ${acct.alias}` : '')
                                }))
                            ]}
                        />
                    </div>
                    <div className="form-group">
                        <label>方向</label>
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
                        <label>股票代碼</label>
                        <input
                            type="text"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            style={{ textTransform: 'uppercase' }}
                            className="input-field"
                        />
                    </div>

                    <div className="form-group">
                        <label>限價</label>
                        <input
                            type="number"
                            value={limitPrice}
                            onChange={(e) => setLimitPrice(e.target.value)}
                            step="0.01"
                            className="input-field"
                        />
                    </div>
                    {/* Bid / Ask display */}
                    {loadingQuote ? (
                        <div className="quote-display">
                            <span className="quote-loading">載入報價中...</span>
                        </div>
                    ) : stockQuote ? (
                        <div className="quote-display">
                            <span className="quote-label">BID</span>
                            <span className="quote-bid">{stockQuote.bid.toFixed(2)}</span>
                            <span className="quote-separator">|</span>
                            <span className="quote-label">ASK</span>
                            <span className="quote-ask">{stockQuote.ask.toFixed(2)}</span>
                            <span className="quote-separator">|</span>
                            <span className="quote-label">LAST</span>
                            <span className="quote-last">{stockQuote.last.toFixed(2)}</span>
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
                                <th style={{ width: '25%' }}>帳號</th>
                                <th style={{ width: '11%' }}>淨值</th>
                                <th style={{ width: '9%' }}>槓桿率</th>
                                <th style={{ width: '8%' }}>方向</th>
                                <th style={{ width: '12%' }}>標的</th>
                                <th style={{ width: '12%' }}>價格</th>
                                <th style={{ width: '19%' }}>數量</th>
                            </tr>
                        </thead>
                        <tbody>
                            {targetAccounts.map((acct) => {
                                const isChecked = checkedAccounts.has(acct.accountId)
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
                                        <td>{acct.accountId}{acct.alias ? ` - ${acct.alias}` : ''}</td>
                                        <td>{acct.netLiquidation.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                                        <td>{acct.netLiquidation > 0 && acct.grossPositionValue > 0 ? (acct.grossPositionValue / acct.netLiquidation).toFixed(2) : '無槓桿'}</td>
                                        {isChecked ? (
                                            <>
                                                <td>{action === 'BUY' ? '買入' : '賣出'}</td>
                                                <td>{symbol.toUpperCase() || '-'}</td>
                                                <td>{limitPrice ? `$${limitPrice}` : '-'}</td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        value={quantities[acct.accountId] || ''}
                                                        onChange={(e) => handleQuantityChange(acct.accountId, e.target.value)}
                                                        min="0"
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
            <div className="order-actions">
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
                                    <th style={{ width: '45%' }}>帳號</th>
                                    <th style={{ width: '8%' }}>方向</th>
                                    <th style={{ width: '12%' }}>標的</th>
                                    <th style={{ width: '12%' }}>限價</th>
                                    <th style={{ width: '8%' }}>數量</th>
                                    <th style={{ width: '15%' }}>交易後槓桿</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(allocations).map(([accountId, qty]) => {
                                    const acct = targetAccounts.find((a) => a.accountId === accountId)
                                    const price = parseFloat(limitPrice) || 0
                                    const orderValue = qty * price
                                    const currentGPV = acct?.grossPositionValue ?? 0
                                    const netLiq = acct?.netLiquidation ?? 0
                                    const newGPV = action === 'BUY' ? currentGPV + orderValue : Math.max(0, currentGPV - orderValue)
                                    const postLeverage = netLiq > 0 && newGPV > 0 ? (newGPV / netLiq).toFixed(2) : '無槓桿'
                                    return (
                                        <tr key={accountId}>
                                            <td>{accountId}{acct?.alias ? ` - ${acct.alias}` : ''}</td>
                                            <td>{action === 'BUY' ? '買入' : '賣出'}</td>
                                            <td>{symbol.toUpperCase()}</td>
                                            <td>${limitPrice}</td>
                                            <td>{qty}</td>
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
