import type { AccountData, PositionData } from '../hooks/useAccountStore'

interface AccountOverviewProps {
    connected: boolean
    accounts: AccountData[]
    positions: PositionData[]
    quotes: Record<string, number>
    loading: boolean
}

export default function AccountOverview({ connected, accounts, positions, quotes, loading }: AccountOverviewProps): JSX.Element {

    const getPositionsForAccount = (accountId: string): PositionData[] => {
        return positions
            .filter((p) => p.account === accountId)
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
