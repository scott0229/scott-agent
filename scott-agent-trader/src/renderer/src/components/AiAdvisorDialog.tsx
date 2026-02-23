import React, { useState, useEffect } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

interface Recommendation {
    position: string
    action: 'roll' | 'hold' | 'close' | 'sell'
    targetExpiry?: string
    targetStrike?: number
    estimatedCredit?: string
    reason: string
}

interface AdvisorResponse {
    recommendations: Recommendation[]
    summary: string
    error?: string
}

interface AiAdvisorDialogProps {
    open: boolean
    onClose: () => void
    account: AccountData
    positions: PositionData[]
    quotes: Record<string, number>
    optionQuotes: Record<string, number>
}

const ACTION_LABELS: Record<string, { text: string; color: string; bg: string }> = {
    roll: { text: '建議展期', color: '#166534', bg: '#dcfce7' },
    hold: { text: '繼續持有', color: '#92400e', bg: '#fef3c7' },
    close: { text: '平倉', color: '#991b1b', bg: '#fee2e2' },
    sell: { text: '賣出 CALL', color: '#1e40af', bg: '#dbeafe' }
}

export default function AiAdvisorDialog({ open, onClose, account, positions, quotes, optionQuotes }: AiAdvisorDialogProps): JSX.Element | null {
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<AdvisorResponse | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Auto-fetch advice when dialog opens
    useEffect(() => {
        if (!open) return
        setLoading(true)
        setResult(null)
        setError(null)

        const acctPositions = positions.filter(p => p.account === account.accountId)

        window.ibApi.getAiAdvice({
            account: {
                accountId: account.accountId,
                alias: account.alias,
                netLiquidation: account.netLiquidation,
                totalCashValue: account.totalCashValue,
                grossPositionValue: account.grossPositionValue
            },
            positions: acctPositions.map(p => ({
                symbol: p.symbol,
                secType: p.secType,
                quantity: p.quantity,
                avgCost: p.avgCost,
                expiry: p.expiry,
                strike: p.strike,
                right: p.right
            })),
            optionQuotes,
            quotes
        }).then(res => {
            if (res.error) {
                setError(res.error)
            } else {
                setResult(res)
            }
        }).catch(err => {
            setError(String(err))
        }).finally(() => {
            setLoading(false)
        })
    }, [open, account.accountId])

    if (!open) return null

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="ai-advisor-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>💡 AI 交易建議 — {account.alias || account.accountId}</h2>
                    <button className="settings-close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="ai-advisor-body">
                    {loading && (
                        <div className="ai-advisor-loading">
                            <div className="ai-advisor-spinner" />
                            <p>正在分析持倉資料並生成建議...</p>
                            <p style={{ fontSize: '0.85em', color: '#888', marginTop: 4 }}>
                                AI 正在讀取歷史交易紀錄、帳戶淨值趨勢，結合當前持倉進行分析
                            </p>
                        </div>
                    )}

                    {error && (
                        <div className="ai-advisor-error">
                            <span style={{ fontSize: '1.5em' }}>⚠️</span>
                            <p>{error}</p>
                        </div>
                    )}

                    {result && (
                        <>
                            {result.recommendations.length > 0 ? (
                                <div className="ai-advisor-recommendations">
                                    {result.recommendations.map((rec, idx) => {
                                        const actionInfo = ACTION_LABELS[rec.action] || ACTION_LABELS.hold
                                        return (
                                            <div key={idx} className="ai-advisor-rec-card">
                                                <div className="ai-advisor-rec-header">
                                                    <span className="ai-advisor-rec-position">{rec.position}</span>
                                                    <span
                                                        className="ai-advisor-rec-action"
                                                        style={{ color: actionInfo.color, backgroundColor: actionInfo.bg }}
                                                    >
                                                        {actionInfo.text}
                                                    </span>
                                                </div>
                                                {(rec.targetExpiry || !!rec.targetStrike) && (
                                                    <div className="ai-advisor-rec-target">
                                                        {rec.targetExpiry && <span>目標到期: {rec.targetExpiry}</span>}
                                                        {!!rec.targetStrike && <span>目標行權: {rec.targetStrike}</span>}
                                                        {rec.estimatedCredit && <span>預估: {rec.estimatedCredit}</span>}
                                                    </div>
                                                )}
                                                <div className="ai-advisor-rec-reason">{rec.reason}</div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : null}

                            {result.summary && (
                                <div className="ai-advisor-summary">
                                    <h3>📝 分析摘要</h3>
                                    <p>{result.summary}</p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
