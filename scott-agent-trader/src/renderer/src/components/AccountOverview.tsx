import { useState, useEffect, useCallback } from 'react'

interface AccountData {
    accountId: string
    netLiquidation: number
    availableFunds: number
    totalCashValue: number
    currency: string
}

interface PositionData {
    account: string
    symbol: string
    secType: string
    quantity: number
    avgCost: number
}

interface AccountOverviewProps {
    connected: boolean
}

export default function AccountOverview({ connected }: AccountOverviewProps): JSX.Element {
    const [accounts, setAccounts] = useState<AccountData[]>([])
    const [positions, setPositions] = useState<PositionData[]>([])
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
        } catch (err: any) {
            console.error('Failed to fetch account data:', err)
        } finally {
            setLoading(false)
        }
    }, [connected])

    useEffect(() => {
        if (connected) {
            fetchData()
        } else {
            setAccounts([])
            setPositions([])
        }
    }, [connected, fetchData])

    const getPositionsForAccount = (accountId: string): PositionData[] => {
        return positions.filter((p) => p.account === accountId)
    }

    const formatCurrency = (value: number, currency: string = 'USD'): string => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency
        }).format(value)
    }

    if (!connected) {
        return (
            <div className="panel">
                <h2 className="panel-title">📊 帳戶總覽</h2>
                <div className="empty-state">請先連線到 TWS / IB Gateway</div>
            </div>
        )
    }

    return (
        <div className="panel">
            <div className="panel-header">
                <h2 className="panel-title">📊 帳戶總覽</h2>
                <button onClick={fetchData} className="btn btn-refresh" disabled={loading}>
                    {loading ? '載入中...' : '🔄 重新整理'}
                </button>
            </div>

            {accounts.length === 0 ? (
                <div className="empty-state">
                    {loading ? '正在載入帳戶資料...' : '未找到帳戶資料'}
                </div>
            ) : (
                <div className="accounts-grid">
                    {accounts.map((account) => (
                        <div key={account.accountId} className="account-card">
                            <div className="account-header">
                                <span className="account-id">{account.accountId}</span>
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
                                    <span className="metric-label">可用資金</span>
                                    <span className="metric-value">
                                        {formatCurrency(account.availableFunds, account.currency)}
                                    </span>
                                </div>
                                <div className="metric">
                                    <span className="metric-label">現金</span>
                                    <span className="metric-value">
                                        {formatCurrency(account.totalCashValue, account.currency)}
                                    </span>
                                </div>
                            </div>

                            {/* Positions */}
                            {getPositionsForAccount(account.accountId).length > 0 && (
                                <div className="positions-section">
                                    <h4 className="positions-title">持倉</h4>
                                    <table className="positions-table">
                                        <thead>
                                            <tr>
                                                <th>標的</th>
                                                <th>數量</th>
                                                <th>成本</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {getPositionsForAccount(account.accountId).map((pos, idx) => (
                                                <tr key={idx}>
                                                    <td className="pos-symbol">{pos.symbol}</td>
                                                    <td className={pos.quantity > 0 ? 'pos-long' : 'pos-short'}>
                                                        {pos.quantity}
                                                    </td>
                                                    <td>{formatCurrency(pos.avgCost)}</td>
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
