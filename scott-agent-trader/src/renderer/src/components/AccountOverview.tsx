import { useState, useMemo } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'
import CustomSelect from './CustomSelect'
import RollOptionDialog from './RollOptionDialog'

interface AccountOverviewProps {
    connected: boolean
    accounts: AccountData[]
    positions: PositionData[]
    quotes: Record<string, number>
    loading: boolean
}

export default function AccountOverview({ connected, accounts, positions, quotes, loading }: AccountOverviewProps): JSX.Element {
    const [sortBy, setSortBy] = useState('netLiquidation')
    const [filterSymbol, setFilterSymbol] = useState('')
    const [filterSecType, setFilterSecType] = useState('')
    const [selectMode, setSelectMode] = useState(false)
    const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set())
    const [showRollDialog, setShowRollDialog] = useState(false)

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

    const toggleSelectMode = (): void => {
        if (selectMode) {
            setSelectedPositions(new Set())
        }
        setSelectMode(!selectMode)
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
            .filter((p) => !filterSecType || (() => {
                if (filterSecType === 'STK') return p.secType !== 'OPT'
                if (p.secType !== 'OPT') return false
                const right = p.right === 'C' || p.right === 'CALL' ? 'CALL' : 'PUT'
                const side = p.quantity < 0 ? 'SELL' : 'BUY'
                if (filterSecType === 'SELL_CALL') return side === 'SELL' && right === 'CALL'
                if (filterSecType === 'BUY_CALL') return side === 'BUY' && right === 'CALL'
                if (filterSecType === 'SELL_PUT') return side === 'SELL' && right === 'PUT'
                if (filterSecType === 'BUY_PUT') return side === 'BUY' && right === 'PUT'
                return true
            })())
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
        if (filterSecType) acctPositions = acctPositions.filter((p) => {
            if (filterSecType === 'STK') return p.secType !== 'OPT'
            if (p.secType !== 'OPT') return false
            const right = p.right === 'C' || p.right === 'CALL' ? 'CALL' : 'PUT'
            const side = p.quantity < 0 ? 'SELL' : 'BUY'
            if (filterSecType === 'SELL_CALL') return side === 'SELL' && right === 'CALL'
            if (filterSecType === 'BUY_CALL') return side === 'BUY' && right === 'CALL'
            if (filterSecType === 'SELL_PUT') return side === 'SELL' && right === 'PUT'
            if (filterSecType === 'BUY_PUT') return side === 'BUY' && right === 'PUT'
            return true
        })
        return !filterSymbol && !filterSecType ? true : acctPositions.length > 0
    })

    return (
        <>
            <div>
                <div className="sort-bar">
                    <div className="select-actions">
                        <button
                            className={`select-toggle-btn${selectMode ? ' active' : ''}`}
                            onClick={toggleSelectMode}
                        >
                            選取{selectMode && selectedPositions.size > 0 ? ` (${selectedPositions.size})` : ''}
                        </button>
                        {selectMode && canRollOptions && (
                            <button className="select-toggle-btn" onClick={() => setShowRollDialog(true)}>
                                批次展期
                            </button>
                        )}
                    </div>
                    <CustomSelect
                        value={filterSymbol}
                        onChange={setFilterSymbol}
                        options={[
                            { value: '', label: '全部標的' },
                            ...uniqueSymbols.map((s) => ({ value: s, label: s }))
                        ]}
                    />
                    <CustomSelect
                        value={filterSecType}
                        onChange={setFilterSecType}
                        options={[
                            { value: '', label: '全部類型' },
                            { value: 'STK', label: '股票' },
                            { value: 'SELL_CALL', label: '賣 CALL' },
                            { value: 'BUY_CALL', label: '買 CALL' },
                            { value: 'SELL_PUT', label: '賣 PUT' },
                            { value: 'BUY_PUT', label: '買 PUT' }
                        ]}
                    />
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
                                    <span className="account-id">{account.accountId}{account.alias ? ` - ${account.alias}` : ''}</span>

                                </div>

                                <div className="account-metrics">
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
                                </div>

                                {/* Stock Positions */}
                                {getPositionsForAccount(account.accountId).filter(p => p.secType !== 'OPT').length > 0 && (
                                    <div className="positions-section">

                                        <table className="positions-table">
                                            <thead>
                                                <tr>
                                                    {selectMode && <th style={{ width: '30px' }}></th>}
                                                    <th>股票</th>
                                                    <th>數量</th>
                                                    <th>均價</th>
                                                    <th>最後價</th>
                                                    <th>盈虧</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {getPositionsForAccount(account.accountId).filter(p => p.secType !== 'OPT').map((pos, idx) => (
                                                    <tr key={idx} className={selectMode ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}` : ''} onClick={selectMode ? () => togglePosition(posKey(pos)) : undefined} style={selectMode ? { cursor: 'pointer' } : undefined}>
                                                        {selectMode && (
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
                                {getPositionsForAccount(account.accountId).filter(p => p.secType === 'OPT').length > 0 && (
                                    <div className="positions-section">

                                        <table className="positions-table">
                                            <thead>
                                                <tr>
                                                    {selectMode && <th style={{ width: '30px' }}></th>}
                                                    <th style={{ width: '35%' }}>期權</th>
                                                    <th style={{ width: '13%' }}>數量</th>
                                                    <th style={{ width: '17%' }}>均價</th>
                                                    <th style={{ width: '17%' }}>最後價</th>
                                                    <th style={{ width: '18%' }}>盈虧</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {getPositionsForAccount(account.accountId).filter(p => p.secType === 'OPT').map((pos, idx) => (
                                                    <tr key={idx} className={selectMode ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}` : ''} onClick={selectMode ? () => togglePosition(posKey(pos)) : undefined} style={selectMode ? { cursor: 'pointer' } : undefined}>
                                                        {selectMode && (
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
