import { useState, useEffect, useCallback, type MutableRefObject } from 'react'

interface AccountData {
    accountId: string
    alias: string
    netLiquidation: number
    availableFunds: number
    totalCashValue: number
    grossPositionValue: number
    currency: string
}

interface PositionData {
    account: string
    symbol: string
    secType: string
    quantity: number
    avgCost: number
    expiry?: string
    strike?: number
    right?: string
}

interface AccountOverviewProps {
    connected: boolean
    refreshRef?: MutableRefObject<(() => void) | null>
}

export default function AccountOverview({ connected, refreshRef }: AccountOverviewProps): JSX.Element {
    const [accounts, setAccounts] = useState<AccountData[]>([])
    const [positions, setPositions] = useState<PositionData[]>([])
    const [quotes, setQuotes] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(false)

    const fetchData = useCallback(async () => {
        if (!connected) return

        setLoading(true)
        try {
            const [accountData, positionData] = await Promise.all([
                window.ibApi.getAccountSummary(),
                window.ibApi.getPositions()
            ])
            setAccounts(accountData)
            setPositions(positionData)
            setLoading(false)

            // Fetch aliases in background (non-blocking)
            const accountIds = accountData.map((a: AccountData) => a.accountId)
            if (accountIds.length > 0) {
                window.ibApi.getAccountAliases(accountIds).then((aliasMap) => {
                    setAccounts((prev) =>
                        prev.map((a) => ({ ...a, alias: aliasMap[a.accountId] || a.alias }))
                    )
                }).catch(() => { /* ignore alias errors */ })
            }

            // Fetch last prices in background (non-blocking)
            const stockSymbols = [...new Set(
                positionData.filter((p: PositionData) => p.secType !== 'OPT').map((p: PositionData) => p.symbol)
            )]
            if (stockSymbols.length > 0) {
                window.ibApi.getQuotes(stockSymbols).then((quoteData) => {
                    setQuotes(quoteData)
                }).catch(() => { /* ignore quote errors */ })
            }
        } catch (err: unknown) {
            console.error('Failed to fetch account data:', err)
            setLoading(false)
        }
    }, [connected])

    useEffect(() => {
        if (connected) {
            fetchData()
            const interval = setInterval(fetchData, 5000)
            return () => clearInterval(interval)
        } else {
            setAccounts([])
            setPositions([])
        }
    }, [connected, fetchData])

    // Register fetchData on refreshRef so parent can trigger refresh
    useEffect(() => {
        if (refreshRef) {
            refreshRef.current = fetchData
        }
        return () => {
            if (refreshRef) {
                refreshRef.current = null
            }
        }
    }, [refreshRef, fetchData])

    const getPositionsForAccount = (accountId: string): PositionData[] => {
        return positions
            .filter((p) => p.account === accountId)
            .sort((a, b) => {
                const aIsStock = a.secType !== 'OPT' ? 0 : 1
                const bIsStock = b.secType !== 'OPT' ? 0 : 1
                if (aIsStock !== bIsStock) return aIsStock - bIsStock
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
            <div className="panel">
                <div className="empty-state">請先連線到 TWS / IB Gateway</div>
            </div>
        )
    }

    return (
        <div className="panel">

            {accounts.length === 0 ? (
                <div className="empty-state">
                    {loading ? '正在載入帳戶資料...' : '未找到帳戶資料'}
                </div>
            ) : (
                <div className="accounts-grid">
                    {[...accounts].sort((a, b) => b.netLiquidation - a.netLiquidation).map((account) => (
                        <div key={account.accountId} className="account-card">
                            <div className="account-header">
                                <span className="account-id">{account.accountId}{account.alias ? ` - ${account.alias}` : ''}</span>
                                <span className="account-currency">{account.currency}</span>
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
                                    <span className="metric-value">
                                        {formatCurrency(account.totalCashValue, account.currency)}
                                    </span>
                                </div>
                                <div className="metric">
                                    <span className="metric-label">槓桿率</span>
                                    <span className="metric-value">
                                        {account.netLiquidation > 0 ? (account.grossPositionValue / account.netLiquidation).toFixed(2) : '-'}
                                    </span>
                                </div>
                            </div>

                            {/* Stock Positions */}
                            {getPositionsForAccount(account.accountId).filter(p => p.secType !== 'OPT').length > 0 && (
                                <div className="positions-section">
                                    <h4 className="positions-title">股票持倉</h4>
                                    <table className="positions-table">
                                        <thead>
                                            <tr>
                                                <th>標的</th>
                                                <th>數量</th>
                                                <th>均價</th>
                                                <th>最後價</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {getPositionsForAccount(account.accountId).filter(p => p.secType !== 'OPT').map((pos, idx) => (
                                                <tr key={idx}>
                                                    <td className="pos-symbol">{formatPositionSymbol(pos)}</td>
                                                    <td className={pos.quantity > 0 ? 'pos-long' : 'pos-short'}>
                                                        {pos.quantity.toLocaleString()}
                                                    </td>
                                                    <td>${pos.avgCost.toFixed(2)}</td>
                                                    <td>{quotes[pos.symbol] ? `$${quotes[pos.symbol].toFixed(2)}` : '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Option Positions */}
                            {getPositionsForAccount(account.accountId).filter(p => p.secType === 'OPT').length > 0 && (
                                <div className="positions-section">
                                    <h4 className="positions-title">期權持倉</h4>
                                    <table className="positions-table">
                                        <thead>
                                            <tr>
                                                <th>標的</th>
                                                <th>數量</th>
                                                <th>均價</th>
                                                <th>最後價</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {getPositionsForAccount(account.accountId).filter(p => p.secType === 'OPT').map((pos, idx) => (
                                                <tr key={idx}>
                                                    <td className="pos-symbol">{formatPositionSymbol(pos)}</td>
                                                    <td className={pos.quantity > 0 ? 'pos-long' : 'pos-short'}>
                                                        {pos.quantity.toLocaleString()}
                                                    </td>
                                                    <td>${(pos.avgCost / 100).toFixed(2)}</td>
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
    )
}
