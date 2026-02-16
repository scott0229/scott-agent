import { useState, useEffect, useCallback } from 'react'

interface AccountData {
    accountId: string
    netLiquidation: number
    availableFunds: number
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
    const [orderType, setOrderType] = useState<'MKT' | 'LMT'>('MKT')
    const [limitPrice, setLimitPrice] = useState('')
    const [totalQuantity, setTotalQuantity] = useState('')
    const [allocMethod, setAllocMethod] = useState<'equal' | 'netLiq' | 'custom'>('equal')

    const [accounts, setAccounts] = useState<AccountData[]>([])
    const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
    const [customQuantities, setCustomQuantities] = useState<Record<string, string>>({})
    const [orderResults, setOrderResults] = useState<OrderResult[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    // Fetch accounts when connected
    useEffect(() => {
        if (connected) {
            window.ibApi.getAccountSummary().then((data) => {
                setAccounts(data)
                // Select all accounts by default
                setSelectedAccounts(new Set(data.map((a) => a.accountId)))
            })
        } else {
            setAccounts([])
            setSelectedAccounts(new Set())
        }
    }, [connected])

    // Listen for order status updates
    useEffect(() => {
        window.ibApi.onOrderStatus((update: OrderResult) => {
            setOrderResults((prev) =>
                prev.map((r) =>
                    r.orderId === update.orderId ? { ...r, ...update, account: r.account, symbol: r.symbol } : r
                )
            )
        })

        return () => {
            window.ibApi.removeAllListeners()
        }
    }, [])

    const toggleAccount = useCallback(
        (accountId: string) => {
            setSelectedAccounts((prev) => {
                const next = new Set(prev)
                if (next.has(accountId)) {
                    next.delete(accountId)
                } else {
                    next.add(accountId)
                }
                return next
            })
        },
        []
    )

    const toggleAll = useCallback(() => {
        if (selectedAccounts.size === accounts.length) {
            setSelectedAccounts(new Set())
        } else {
            setSelectedAccounts(new Set(accounts.map((a) => a.accountId)))
        }
    }, [accounts, selectedAccounts])

    // Calculate allocation for each account
    const calculateAllocations = useCallback((): Record<string, number> => {
        const total = parseInt(totalQuantity, 10) || 0
        const selected = accounts.filter((a) => selectedAccounts.has(a.accountId))

        if (selected.length === 0 || total === 0) return {}

        const allocations: Record<string, number> = {}

        if (allocMethod === 'equal') {
            const perAccount = Math.floor(total / selected.length)
            let remainder = total - perAccount * selected.length
            for (const acct of selected) {
                allocations[acct.accountId] = perAccount + (remainder > 0 ? 1 : 0)
                if (remainder > 0) remainder--
            }
        } else if (allocMethod === 'netLiq') {
            const totalNLV = selected.reduce((sum, a) => sum + a.netLiquidation, 0)
            if (totalNLV === 0) return {}
            let allocated = 0
            for (let i = 0; i < selected.length; i++) {
                const acct = selected[i]
                if (i === selected.length - 1) {
                    // Last account gets remainder to avoid rounding issues
                    allocations[acct.accountId] = total - allocated
                } else {
                    const qty = Math.floor((acct.netLiquidation / totalNLV) * total)
                    allocations[acct.accountId] = qty
                    allocated += qty
                }
            }
        } else if (allocMethod === 'custom') {
            for (const acct of selected) {
                allocations[acct.accountId] = parseInt(customQuantities[acct.accountId] || '0', 10) || 0
            }
        }

        return allocations
    }, [accounts, selectedAccounts, totalQuantity, allocMethod, customQuantities])

    const allocations = calculateAllocations()

    const handleSubmit = useCallback(async () => {
        if (!symbol.trim() || Object.keys(allocations).length === 0) return

        setSubmitting(true)
        setShowConfirm(false)
        try {
            const request = {
                symbol: symbol.toUpperCase(),
                action,
                orderType,
                limitPrice: orderType === 'LMT' ? parseFloat(limitPrice) : undefined,
                totalQuantity: parseInt(totalQuantity, 10)
            }

            const results = await window.ibApi.placeBatchOrders(request, allocations)
            setOrderResults(results)
        } catch (err: any) {
            console.error('Batch order failed:', err)
        } finally {
            setSubmitting(false)
        }
    }, [symbol, action, orderType, limitPrice, totalQuantity, allocations])

    const totalAllocated = Object.values(allocations).reduce((sum, q) => sum + q, 0)

    if (!connected) {
        return (
            <div className="panel">
                <h2 className="panel-title">📋 批次下單</h2>
                <div className="empty-state">請先連線到 TWS / IB Gateway</div>
            </div>
        )
    }

    return (
        <div className="panel">
            <h2 className="panel-title">📋 批次下單</h2>

            {/* Order Form */}
            <div className="order-form">
                <div className="form-row">
                    <div className="form-group">
                        <label>股票代碼</label>
                        <input
                            type="text"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                            placeholder="例如 TQQQ"
                            className="input-field"
                        />
                    </div>
                    <div className="form-group">
                        <label>方向</label>
                        <select
                            value={action}
                            onChange={(e) => setAction(e.target.value as 'BUY' | 'SELL')}
                            className="input-field"
                        >
                            <option value="BUY">買入</option>
                            <option value="SELL">賣出</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>訂單類型</label>
                        <select
                            value={orderType}
                            onChange={(e) => setOrderType(e.target.value as 'MKT' | 'LMT')}
                            className="input-field"
                        >
                            <option value="MKT">市價單</option>
                            <option value="LMT">限價單</option>
                        </select>
                    </div>
                    {orderType === 'LMT' && (
                        <div className="form-group">
                            <label>限價</label>
                            <input
                                type="number"
                                value={limitPrice}
                                onChange={(e) => setLimitPrice(e.target.value)}
                                placeholder="0.00"
                                step="0.01"
                                className="input-field"
                            />
                        </div>
                    )}
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>總數量</label>
                        <input
                            type="number"
                            value={totalQuantity}
                            onChange={(e) => setTotalQuantity(e.target.value)}
                            placeholder="0"
                            min="0"
                            className="input-field"
                            disabled={allocMethod === 'custom'}
                        />
                    </div>
                    <div className="form-group">
                        <label>分配方式</label>
                        <select
                            value={allocMethod}
                            onChange={(e) => setAllocMethod(e.target.value as 'equal' | 'netLiq' | 'custom')}
                            className="input-field"
                        >
                            <option value="equal">等量分配</option>
                            <option value="netLiq">按淨值比例</option>
                            <option value="custom">自訂數量</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Account Selection & Allocation Preview */}
            <div className="allocation-section">
                <div className="allocation-header">
                    <h3>帳戶分配</h3>
                    <button onClick={toggleAll} className="btn btn-small">
                        {selectedAccounts.size === accounts.length ? '取消全選' : '全選'}
                    </button>
                </div>

                <table className="allocation-table">
                    <thead>
                        <tr>
                            <th>選取</th>
                            <th>帳戶</th>
                            <th>淨值</th>
                            <th>分配數量</th>
                        </tr>
                    </thead>
                    <tbody>
                        {accounts.map((acct) => (
                            <tr
                                key={acct.accountId}
                                className={selectedAccounts.has(acct.accountId) ? 'selected' : 'unselected'}
                            >
                                <td>
                                    <input
                                        type="checkbox"
                                        checked={selectedAccounts.has(acct.accountId)}
                                        onChange={() => toggleAccount(acct.accountId)}
                                    />
                                </td>
                                <td className="acct-id">{acct.accountId}</td>
                                <td>
                                    {new Intl.NumberFormat('en-US', {
                                        style: 'currency',
                                        currency: 'USD'
                                    }).format(acct.netLiquidation)}
                                </td>
                                <td>
                                    {allocMethod === 'custom' && selectedAccounts.has(acct.accountId) ? (
                                        <input
                                            type="number"
                                            value={customQuantities[acct.accountId] || ''}
                                            onChange={(e) =>
                                                setCustomQuantities((prev) => ({
                                                    ...prev,
                                                    [acct.accountId]: e.target.value
                                                }))
                                            }
                                            className="input-field input-small"
                                            min="0"
                                        />
                                    ) : (
                                        <span className="alloc-qty">
                                            {selectedAccounts.has(acct.accountId)
                                                ? allocations[acct.accountId] || 0
                                                : '-'}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colSpan={3} className="total-label">
                                合計
                            </td>
                            <td className="total-value">{totalAllocated}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Submit */}
            <div className="order-actions">
                {!showConfirm ? (
                    <button
                        onClick={() => setShowConfirm(true)}
                        className="btn btn-primary"
                        disabled={
                            !symbol.trim() ||
                            totalAllocated === 0 ||
                            submitting
                        }
                    >
                        預覽下單
                    </button>
                ) : (
                    <div className="confirm-section">
                        <div className="confirm-summary">
                            確定要 <strong>{action === 'BUY' ? '買入' : '賣出'}</strong>{' '}
                            <strong>{symbol.toUpperCase()}</strong>{' '}
                            共 <strong>{totalAllocated}</strong> 股，
                            分配到 <strong>{selectedAccounts.size}</strong> 個帳戶？
                            {orderType === 'LMT' && ` 限價: $${limitPrice}`}
                        </div>
                        <div className="confirm-buttons">
                            <button onClick={handleSubmit} className="btn btn-danger" disabled={submitting}>
                                {submitting ? '下單中...' : '✅ 確認下單'}
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
