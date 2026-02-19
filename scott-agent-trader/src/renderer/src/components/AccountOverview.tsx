import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import type { AccountData, PositionData, OpenOrderData, ExecutionDataItem } from '../hooks/useAccountStore'
import CustomSelect from './CustomSelect'
import RollOptionDialog from './RollOptionDialog'

interface AccountOverviewProps {
    connected: boolean
    accounts: AccountData[]
    positions: PositionData[]
    quotes: Record<string, number>
    openOrders: OpenOrderData[]
    executions: ExecutionDataItem[]
    loading: boolean
    refresh?: () => void
}

export default function AccountOverview({ connected, accounts, positions, quotes, openOrders, executions, loading, refresh }: AccountOverviewProps): JSX.Element {
    const [sortBy, setSortBy] = useState('netLiquidation')
    const [filterSymbol, setFilterSymbol] = useState('')

    const [selectMode, setSelectMode] = useState<'STK' | 'OPT' | false>(false)
    const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set())
    const [showRollDialog, setShowRollDialog] = useState(false)
    // Inline editing state: tracks which cell is being edited
    const [editingCell, setEditingCell] = useState<{ orderId: number; field: 'quantity' | 'price' } | null>(null)
    const [editValue, setEditValue] = useState('')
    const editInputRef = useRef<HTMLInputElement | null>(null)

    // Auto-focus input when entering edit mode
    useEffect(() => {
        if (editingCell && editInputRef.current) {
            editInputRef.current.focus()
            editInputRef.current.select()
        }
    }, [editingCell])

    const startEdit = useCallback((order: OpenOrderData, field: 'quantity' | 'price') => {
        const current = field === 'quantity' ? String(order.quantity) : (order.limitPrice ?? 0).toFixed(2)
        setEditingCell({ orderId: order.orderId, field })
        setEditValue(current)
    }, [])

    const cancelEdit = useCallback(() => {
        setEditingCell(null)
        setEditValue('')
    }, [])

    const submitEdit = useCallback((order: OpenOrderData, field: 'quantity' | 'price', value: string) => {
        const val = parseFloat(value)
        if (isNaN(val) || val <= 0) { cancelEdit(); return }
        const newQty = field === 'quantity' ? val : order.quantity
        const newPrice = field === 'price' ? val : (order.limitPrice ?? 0)
        console.log('[EDIT] submitting modify order:', { orderId: order.orderId, newQty, newPrice })
        window.ibApi.modifyOrder({
            orderId: order.orderId,
            account: order.account,
            symbol: order.symbol,
            secType: order.secType,
            action: order.action,
            orderType: order.orderType,
            quantity: newQty,
            limitPrice: newPrice,
            expiry: order.expiry,
            strike: order.strike,
            right: order.right
        }).then(() => {
            console.log('[EDIT] modifyOrder succeeded')
            setTimeout(() => refresh?.(), 500)
        }).catch((err: unknown) => {
            console.error('[EDIT] modifyOrder failed:', err)
            alert('修改委託失敗: ' + String(err))
        })
        cancelEdit()
    }, [cancelEdit, refresh])


    const posKey = (pos: PositionData): string =>
        `${pos.account}|${pos.symbol}|${pos.secType}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`

    const togglePosition = (key: string): void => {
        setSelectedPositions((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const toggleSelectMode = (mode: 'STK' | 'OPT'): void => {
        if (selectMode === mode) {
            setSelectedPositions(new Set())
            setSelectMode(false)
        } else {
            setSelectedPositions(new Set())
            setSelectMode(mode)
        }
    }

    const canRollOptions = useMemo(() => {
        if (selectedPositions.size === 0) return false
        const selected = positions.filter((p) => selectedPositions.has(posKey(p)))
        if (selected.length === 0) return false
        if (!selected.every((p) => p.secType === 'OPT')) return false
        const symbol = selected[0].symbol
        const right = selected[0].right
        const side = selected[0].quantity < 0 ? 'SELL' : 'BUY'
        return selected.every((p) => {
            const pSide = p.quantity < 0 ? 'SELL' : 'BUY'
            return p.symbol === symbol && p.right === right && pSide === side
        })
    }, [selectedPositions, positions])

    const uniqueSymbols = useMemo(() => {
        const set = new Set<string>()
        positions.forEach((p) => set.add(p.symbol))
        return Array.from(set).sort()
    }, [positions])

    const getPositionsForAccount = (accountId: string): PositionData[] => {
        return positions
            .filter((p) => p.account === accountId)
            .filter((p) => !filterSymbol || p.symbol === filterSymbol)

            .sort((a, b) => {
                const aIsStock = a.secType !== 'OPT' ? 0 : 1
                const bIsStock = b.secType !== 'OPT' ? 0 : 1
                if (aIsStock !== bIsStock) return aIsStock - bIsStock
                // Options: sort by expiry date (nearest first)
                if (a.secType === 'OPT' && b.secType === 'OPT') {
                    return (a.expiry || '').localeCompare(b.expiry || '')
                }
                return (b.avgCost * Math.abs(b.quantity)) - (a.avgCost * Math.abs(a.quantity))
            })
    }

    const formatCurrency = (value: number, currency: string = 'USD'): string => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value)
    }

    const formatPositionSymbol = (pos: PositionData): string => {
        if (pos.secType === 'OPT' && pos.expiry && pos.strike && pos.right) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            // expiry format from IB: "20260217"
            const year = pos.expiry.substring(2, 4)
            const month = months[parseInt(pos.expiry.substring(4, 6)) - 1]
            const day = pos.expiry.substring(6, 8)
            const strike = Number.isInteger(pos.strike) ? pos.strike.toString() : pos.strike.toFixed(1)
            const right = pos.right === 'C' || pos.right === 'CALL' ? 'CALL' : 'PUT'
            return `${pos.symbol} ${month}${day}'${year} ${strike} ${right}`
        }
        return pos.symbol
    }
    if (!connected) {
        return (
            <div>
                <div className="empty-state">請先連線到 TWS / IB Gateway</div>
            </div>
        )
    }

    const sortedAccounts = [...accounts].sort((a, b) => {
        if (sortBy === 'netLiquidation') return b.netLiquidation - a.netLiquidation
        if (sortBy === 'margin') {
            const aRatio = a.netLiquidation > 0 ? a.grossPositionValue / a.netLiquidation : 0
            const bRatio = b.netLiquidation > 0 ? b.grossPositionValue / b.netLiquidation : 0
            return bRatio - aRatio
        }
        return b.totalCashValue - a.totalCashValue
    })

    // Filter accounts: when filters are active, only show accounts with matching positions
    const displayAccounts = sortedAccounts.filter((a) => {
        let acctPositions = positions.filter((p) => p.account === a.accountId)
        if (filterSymbol) acctPositions = acctPositions.filter((p) => p.symbol === filterSymbol)
        if (selectMode === 'STK') acctPositions = acctPositions.filter((p) => p.secType !== 'OPT')
        if (selectMode === 'OPT') acctPositions = acctPositions.filter((p) => p.secType === 'OPT')
        if (filterSymbol || selectMode) return acctPositions.length > 0
        return true
    })

    return (
        <>
            <div>
                <div className="sort-bar">
                    <div className="select-actions">
                        <button
                            className={`select-toggle-btn${selectMode === 'STK' ? ' active' : ''}`}
                            onClick={() => toggleSelectMode('STK')}
                        >
                            選取股票{selectMode === 'STK' && selectedPositions.size > 0 ? ` (${selectedPositions.size})` : ''}
                        </button>
                        <button
                            className={`select-toggle-btn${selectMode === 'OPT' ? ' active' : ''}`}
                            onClick={() => toggleSelectMode('OPT')}
                        >
                            選取期權{selectMode === 'OPT' && selectedPositions.size > 0 ? ` (${selectedPositions.size})` : ''}
                        </button>
                        <CustomSelect
                            value={filterSymbol}
                            onChange={(v) => { setFilterSymbol(v); setSelectedPositions(new Set()) }}
                            options={[
                                { value: '', label: '全部標的' },
                                ...uniqueSymbols.map((s) => ({ value: s, label: s }))
                            ]}
                        />
                        {selectMode && (
                            <button className="select-toggle-btn" onClick={() => {
                                const allKeys = new Set<string>()
                                displayAccounts.forEach((acct) => {
                                    getPositionsForAccount(acct.accountId)
                                        .filter((p) => selectMode === 'OPT' ? p.secType === 'OPT' : p.secType !== 'OPT')
                                        .forEach((p) => allKeys.add(posKey(p)))
                                })
                                setSelectedPositions((prev) => prev.size === allKeys.size ? new Set() : allKeys)
                            }}>
                                全選
                            </button>
                        )}
                        {selectMode && canRollOptions && (
                            <button className="select-toggle-btn" onClick={() => setShowRollDialog(true)}>
                                展期
                            </button>
                        )}
                    </div>
                    <CustomSelect
                        value={sortBy}
                        onChange={setSortBy}
                        options={[
                            { value: 'netLiquidation', label: '淨值-從高到低' },
                            { value: 'margin', label: '融資-從高到低' },
                            { value: 'cash', label: '現金-從多到少' }
                        ]}
                    />
                </div>

                {accounts.length === 0 ? (
                    <div className="empty-state">
                        {loading ? '正在載入帳戶資料...' : '未找到帳戶資料'}
                    </div>
                ) : (
                    <div className="accounts-grid">
                        {displayAccounts.map((account) => (
                            <div key={account.accountId} className="account-card">
                                <div className="account-header">
                                    <span className="account-id">{account.alias || account.accountId}</span>

                                </div>

                                {!selectMode && <div className="account-metrics">
                                    <div className="metric">
                                        <span className="metric-label">淨值</span>
                                        <span className="metric-value">
                                            {formatCurrency(account.netLiquidation, account.currency)}
                                        </span>
                                    </div>

                                    <div className="metric">
                                        <span className="metric-label">現金</span>
                                        <span className="metric-value" style={account.totalCashValue < 0 ? { color: '#b91c1c' } : undefined}>
                                            {formatCurrency(account.totalCashValue, account.currency)}
                                        </span>
                                    </div>
                                    <div className="metric">
                                        <span className="metric-label">融資率</span>
                                        <span className="metric-value">
                                            {account.netLiquidation > 0 ? (account.grossPositionValue / account.netLiquidation).toFixed(2) : '-'}
                                        </span>
                                    </div>
                                    <div className="metric">
                                        <span className="metric-label">潛在融資</span>
                                        <span className="metric-value">
                                            {(() => {
                                                if (account.netLiquidation <= 0) return '-'
                                                const putAssignmentCost = positions
                                                    .filter(p => p.account === account.accountId && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT') && p.quantity < 0)
                                                    .reduce((sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity), 0)
                                                return ((account.grossPositionValue + putAssignmentCost) / account.netLiquidation).toFixed(2)
                                            })()}
                                        </span>
                                    </div>
                                </div>}

                                {/* Stock Positions */}
                                {selectMode !== 'OPT' && getPositionsForAccount(account.accountId).filter(p => p.secType !== 'OPT').length > 0 && (
                                    <div className="positions-section">

                                        <table className="positions-table">
                                            <thead>
                                                <tr>
                                                    {selectMode === 'STK' && <th style={{ width: '30px' }}></th>}
                                                    <th>股票</th>
                                                    <th>數量</th>
                                                    <th>均價</th>
                                                    <th>最後價</th>
                                                    <th>盈虧</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {getPositionsForAccount(account.accountId).filter(p => p.secType !== 'OPT').map((pos, idx) => (
                                                    <tr key={idx} className={selectMode === 'STK' ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}` : ''} onClick={selectMode === 'STK' ? () => togglePosition(posKey(pos)) : undefined} style={selectMode === 'STK' ? { cursor: 'pointer' } : undefined}>
                                                        {selectMode === 'STK' && (
                                                            <td style={{ textAlign: 'center' }}>
                                                                <input type="checkbox" checked={selectedPositions.has(posKey(pos))} onChange={() => togglePosition(posKey(pos))} onClick={(e) => e.stopPropagation()} />
                                                            </td>
                                                        )}
                                                        <td className="pos-symbol">{formatPositionSymbol(pos)}</td>
                                                        <td className={pos.quantity > 0 ? 'pos-long' : 'pos-short'}>
                                                            {pos.quantity.toLocaleString()}
                                                        </td>
                                                        <td>${pos.avgCost.toFixed(2)}</td>
                                                        <td>{quotes[pos.symbol] ? `$${quotes[pos.symbol].toFixed(2)}` : '-'}</td>
                                                        <td style={{ color: quotes[pos.symbol] ? ((quotes[pos.symbol] - pos.avgCost) * pos.quantity >= 0 ? '#1a6b3a' : '#8b1a1a') : undefined }}>
                                                            {quotes[pos.symbol] ? `$${((quotes[pos.symbol] - pos.avgCost) * pos.quantity).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '-'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Option Positions */}
                                {selectMode !== 'STK' && getPositionsForAccount(account.accountId).filter(p => p.secType === 'OPT').length > 0 && (
                                    <div className="positions-section">

                                        <table className="positions-table">
                                            <thead>
                                                <tr>
                                                    {selectMode === 'OPT' && <th style={{ width: '30px' }}></th>}
                                                    <th style={{ width: '35%' }}>期權</th>
                                                    <th style={{ width: '13%' }}>數量</th>
                                                    <th style={{ width: '17%' }}>均價</th>
                                                    <th style={{ width: '17%' }}>最後價</th>
                                                    <th style={{ width: '18%' }}>盈虧</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {getPositionsForAccount(account.accountId).filter(p => p.secType === 'OPT').map((pos, idx) => (
                                                    <tr key={idx} className={selectMode === 'OPT' ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}` : ''} onClick={selectMode === 'OPT' ? () => togglePosition(posKey(pos)) : undefined} style={selectMode === 'OPT' ? { cursor: 'pointer' } : undefined}>
                                                        {selectMode === 'OPT' && (
                                                            <td style={{ textAlign: 'center' }}>
                                                                <input type="checkbox" checked={selectedPositions.has(posKey(pos))} onChange={() => togglePosition(posKey(pos))} onClick={(e) => e.stopPropagation()} />
                                                            </td>
                                                        )}
                                                        <td className="pos-symbol">{formatPositionSymbol(pos)}</td>
                                                        <td className={pos.quantity > 0 ? 'pos-long' : 'pos-short'}>
                                                            {pos.quantity.toLocaleString()}
                                                        </td>
                                                        <td>${(pos.avgCost / 100).toFixed(2)}</td>
                                                        <td>-</td>
                                                        <td>-</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Open Orders */}
                                {!selectMode && openOrders.filter(o => o.account === account.accountId).length > 0 && (
                                    <div className="positions-section">

                                        <table className="positions-table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '35%' }}>委託</th>
                                                    <th style={{ width: '13%' }}>方向</th>
                                                    <th style={{ width: '13%' }}>數量</th>
                                                    <th style={{ width: '20%' }}>價格</th>
                                                    <th style={{ width: '19%' }}>狀態</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {openOrders.filter(o => o.account === account.accountId).map((order) => {
                                                    const desc = order.secType === 'OPT'
                                                        ? `${order.symbol} ${order.expiry ? order.expiry.replace(/^(\d{4})(\d{2})(\d{2})$/, '$2/$3') : ''} ${order.strike || ''} ${order.right === 'C' || order.right === 'CALL' ? 'C' : 'P'}`
                                                        : order.symbol
                                                    return (
                                                        <tr key={order.orderId}>
                                                            <td className="pos-symbol">{desc}</td>
                                                            <td style={{ color: order.action === 'BUY' ? '#1a6b3a' : '#8b1a1a', fontWeight: 600 }}>
                                                                {order.action === 'BUY' ? '買' : '賣'}
                                                            </td>
                                                            <td
                                                                style={{ cursor: 'pointer' }}
                                                                onDoubleClick={() => startEdit(order, 'quantity')}
                                                            >
                                                                {editingCell?.orderId === order.orderId && editingCell.field === 'quantity' ? (
                                                                    <input
                                                                        ref={editInputRef}
                                                                        type="number"
                                                                        step="1"
                                                                        value={editValue}
                                                                        onChange={(e) => setEditValue(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') submitEdit(order, 'quantity', editValue)
                                                                            if (e.key === 'Escape') cancelEdit()
                                                                        }}
                                                                        onBlur={() => cancelEdit()}
                                                                        style={{ width: '60px', padding: '2px 4px', fontSize: '13px', background: 'transparent', border: '1px solid #94a3b8', borderRadius: '3px', color: 'inherit', outline: 'none', textAlign: 'center' }}
                                                                    />
                                                                ) : order.quantity}
                                                            </td>
                                                            <td
                                                                style={{ cursor: order.orderType === 'LMT' ? 'pointer' : 'default' }}
                                                                onDoubleClick={() => { if (order.orderType === 'LMT') startEdit(order, 'price') }}
                                                            >
                                                                {editingCell?.orderId === order.orderId && editingCell.field === 'price' ? (
                                                                    <input
                                                                        ref={editInputRef}
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={editValue}
                                                                        onChange={(e) => setEditValue(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') submitEdit(order, 'price', editValue)
                                                                            if (e.key === 'Escape') cancelEdit()
                                                                        }}
                                                                        onBlur={() => cancelEdit()}
                                                                        style={{ width: '80px', padding: '2px 4px', fontSize: '13px', background: 'transparent', border: '1px solid #94a3b8', borderRadius: '3px', color: 'inherit', outline: 'none', textAlign: 'center' }}
                                                                    />
                                                                ) : order.orderType === 'LMT' ? `$${(order.limitPrice ?? 0).toFixed(2)}` : '市價'}
                                                            </td>
                                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                                {order.status}
                                                                <button
                                                                    onClick={() => {
                                                                        if (!confirm(`確定要取消 ${order.symbol} 的委託嗎？`)) return
                                                                        window.ibApi.cancelOrder(order.orderId).then(() => {
                                                                            console.log('[CANCEL] cancelOrder succeeded')
                                                                            setTimeout(() => refresh?.(), 500)
                                                                        }).catch((err: unknown) => {
                                                                            console.error('[CANCEL] cancelOrder failed:', err)
                                                                            alert('取消委託失敗: ' + String(err))
                                                                        })
                                                                    }}
                                                                    className="cancel-order-btn"
                                                                    title="取消委託"
                                                                >✕</button>
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Today's Filled Orders */}
                                {!selectMode && executions.filter(e => e.account === account.accountId).length > 0 && (
                                    <div className="positions-section">

                                        <table className="positions-table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '35%' }}>今日成交</th>
                                                    <th style={{ width: '13%' }}>方向</th>
                                                    <th style={{ width: '13%' }}>數量</th>
                                                    <th style={{ width: '20%' }}>成交價</th>
                                                    <th style={{ width: '19%' }}>時間</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {executions.filter(e => e.account === account.accountId).map((exec) => {
                                                    const desc = exec.secType === 'OPT'
                                                        ? `${exec.symbol} ${exec.expiry ? exec.expiry.replace(/^(\d{4})(\d{2})(\d{2})$/, '$2/$3') : ''} ${exec.strike || ''} ${exec.right === 'C' || exec.right === 'CALL' ? 'C' : 'P'}`
                                                        : exec.symbol
                                                    const isAssignment = exec.orderId === 0 && exec.price === 0 && exec.secType === 'OPT'
                                                    // Format "20260218 18:14:12 Asia/Taipei" → "0218 18:14"
                                                    const fmtTime = exec.time.replace(/^\d{4}(\d{2})(\d{2})\s+(\d{2}:\d{2}).*$/, '$1/$2 $3')
                                                    return (
                                                        <tr key={exec.execId}>
                                                            <td className="pos-symbol">{desc}{isAssignment && <span style={{ color: '#1a6baa', fontWeight: 600, marginLeft: 6, fontSize: '0.92em' }}>(到期)</span>}</td>
                                                            <td style={{ color: exec.side === 'BOT' ? '#1a6b3a' : '#8b1a1a', fontWeight: 600 }}>
                                                                {exec.side === 'BOT' ? '買' : '賣'}
                                                            </td>
                                                            <td>{exec.quantity}</td>
                                                            <td>${exec.avgPrice.toFixed(2)}</td>
                                                            <td>{fmtTime}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <RollOptionDialog
                open={showRollDialog}
                onClose={() => setShowRollDialog(false)}
                selectedPositions={positions.filter((p) => selectedPositions.has(posKey(p)))}
                accounts={accounts}
            />

        </>
    )
}
