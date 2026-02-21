import { useState } from 'react'
import type { AccountData } from '../hooks/useAccountStore'

const LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

interface SettingsPanelProps {
    open: boolean
    onClose: () => void
    accounts: AccountData[]
    hiddenAccounts: Set<string>
    onToggleAccount: (accountId: string) => void
    marginLimit: number
    onSetMarginLimit: (limit: number) => void
    watchSymbols: string[]
    onSetWatchSymbol: (index: number, value: string) => void
    onSetApiKey: (key: string) => void
}

function SectionHeader({ title, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) {
    return (
        <div
            onClick={onToggle}
            style={{ cursor: 'pointer', userSelect: 'none', marginTop: 16, marginBottom: 8 }}
        >
            <h3 className="settings-section-title" style={{ margin: 0 }}>{title}</h3>
        </div>
    )
}

export default function SettingsPanel({
    open,
    onClose,
    accounts,
    hiddenAccounts,
    onToggleAccount,
    marginLimit,
    onSetMarginLimit,
    watchSymbols,
    onSetWatchSymbol,
    onSetApiKey
}: SettingsPanelProps): JSX.Element | null {
    const [limitInput, setLimitInput] = useState(String(marginLimit))
    const [showRisk, setShowRisk] = useState(true)
    const [showSymbols, setShowSymbols] = useState(true)
    const [showAccounts, setShowAccounts] = useState(true)
    const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('scott-trader-api-key') || '')

    if (!open) return null

    const sorted = [...accounts].sort((a, b) => (b.netLiquidation || 0) - (a.netLiquidation || 0))

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>設定</h2>
                    <button className="settings-close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="settings-body">
                    <SectionHeader title="風險參數" expanded={showRisk} onToggle={() => setShowRisk(v => !v)} />
                    {showRisk && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 8px' }}>
                        <label style={{ fontSize: '0.95em', color: '#555', whiteSpace: 'nowrap' }}>潛在融資上限</label>
                        <input
                            type="number"
                            step="0.01"
                            min="1"
                            max="5"
                            value={limitInput}
                            onChange={(e) => setLimitInput(e.target.value)}
                            onBlur={() => {
                                const v = parseFloat(limitInput)
                                if (!isNaN(v) && v > 0) {
                                    onSetMarginLimit(v)
                                } else {
                                    setLimitInput(String(marginLimit))
                                }
                            }}
                            style={{ width: 80, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.95em', textAlign: 'center' }}
                        />
                    </div>}

                    <SectionHeader title="可交易標的" expanded={showSymbols} onToggle={() => setShowSymbols(v => !v)} />
                    {showSymbols && LABELS.map((label, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 8px' }}>
                            <label style={{ fontSize: '0.95em', color: '#555' }}>標的{label}</label>
                            <input
                                type="text"
                                value={watchSymbols[i] || ''}
                                onChange={(e) => onSetWatchSymbol(i, e.target.value.toUpperCase())}
                                placeholder=""
                                style={{ width: 100, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.95em', textAlign: 'center', textTransform: 'uppercase' }}
                            />
                        </div>
                    ))}

                    <SectionHeader title="帳戶顯示" expanded={showAccounts} onToggle={() => setShowAccounts(v => !v)} />
                    {showAccounts && (
                        <div className="settings-account-list">
                            {sorted.map((acct) => {
                                const isHidden = hiddenAccounts.has(acct.accountId)
                                return (
                                    <label key={acct.accountId} className="settings-account-row">
                                        <span className="settings-account-name">
                                            {acct.alias || acct.accountId}
                                        </span>
                                        <input
                                            type="checkbox"
                                            checked={!isHidden}
                                            onChange={() => onToggleAccount(acct.accountId)}
                                        />
                                    </label>
                                )
                            })}
                        </div>
                    )}
                    <SectionHeader title="雲端同步" expanded={true} onToggle={() => { }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 8px' }}>
                        <label style={{ fontSize: '0.95em', color: '#555', whiteSpace: 'nowrap' }}>API Key</label>
                        <input
                            type="password"
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            onBlur={() => onSetApiKey(apiKeyInput.trim())}
                            placeholder="貼上 Cloudflare API Key"
                            style={{ width: 180, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85em' }}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
